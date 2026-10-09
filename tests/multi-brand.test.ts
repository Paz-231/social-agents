import { describe, it, expect, vi } from 'vitest';
import { Script } from 'node:vm';
import { consoleScript } from '../src/deployment/console.js';
import { once } from 'node:events';
import { brandConfig, authenticate, draftSchema, type Brand } from '../src/deployment/brands.js';
import { PostizDraftGateway } from '../src/deployment/postizDrafts.js';
import { brandServer } from '../src/deployment/brandServer.js';
import { BrandStore } from '../src/deployment/brandStore.js';
import { DraftService } from '../src/deployment/draftService.js';
const pasara: Brand = { slug:'pasara-surf',name:'PASARA SURF',integrationId:'pasara-id',provider:'instagram' };
const camp: Brand = { slug:'runmycamp',name:'RunMyCamp',integrationId:'camp-id',provider:'instagram-standalone' };
const token = 'p'.repeat(48);
const principal = { id:'reviewer',token,workspaces:['pasara-surf' as const] };
const payload = { caption:'Draft',postType:'post',media:[{ id:'asset',path:'https://uploads.postiz.com/asset.jpg' }] };
describe('multi-brand authorization and provider contract', () => {
  it('serves syntactically valid browser code', () => { expect(() => new Script(consoleScript)).not.toThrow(); });
  it('rejects duplicate/swapped channels, workspace grants and weak credentials', () => {
    const env = { SOCIAL_OS_BRANDS:JSON.stringify([pasara,camp]),SOCIAL_OS_PRINCIPALS:JSON.stringify([principal]) };
    expect(brandConfig(env).brands).toHaveLength(2);
    for (const brands of [[pasara,pasara],[pasara,{...camp,integrationId:pasara.integrationId}],[pasara,{...camp,provider:'instagram'}]]) {
      expect(() => brandConfig({...env,SOCIAL_OS_BRANDS:JSON.stringify(brands)})).toThrow();
    }
    expect(() => brandConfig({...env,SOCIAL_OS_PRINCIPALS:JSON.stringify([{...principal,token:'short'}])})).toThrow();
    expect(authenticate('Bearer '+token,[principal])?.id).toBe('reviewer');
    expect(authenticate('Bearer wrong',[principal])).toBeUndefined();
    expect(() => draftSchema.parse({...payload,scheduleAt:'2099-01-01'})).toThrow();
    expect(() => draftSchema.parse({...payload,media:[{id:'asset',path:'http://localhost/image'}]})).toThrow();
  });
  it.each([pasara,camp])('uses only draft and the verified channel for $slug', async brand => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json([{id:brand.integrationId,identifier:brand.provider}]))
      .mockResolvedValueOnce(Response.json([{postId:'draft-id',integration:brand.integrationId}]))
      .mockResolvedValueOnce(Response.json({posts:[{id:'draft-id',state:'DRAFT',integration:{id:brand.integrationId,providerIdentifier:brand.provider}}]}));
    const gateway = new PostizDraftGateway('secret',undefined,fetcher);
    await gateway.verifyBinding(brand);
    expect(await gateway.createDraft(brand,payload)).toBe('draft-id');
    await gateway.verifyDraft(brand,'draft-id',new Date().toISOString());
    const request = JSON.parse(fetcher.mock.calls[1]![1].body);
    expect(request.type).toBe('draft');
    expect(request.posts[0]).toMatchObject({integration:{id:brand.integrationId},settings:{__type:brand.provider,post_type:'post'}});
    expect(fetcher.mock.calls[1]![1].redirect).toBe('error');
  });
  it('rejects mismatched, queued, disabled and uncertain provider replies without returning raw errors', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json([{id:pasara.integrationId,identifier:camp.provider}]))
      .mockResolvedValueOnce(Response.json([{id:pasara.integrationId,identifier:pasara.provider,disabled:true}]))
      .mockResolvedValueOnce(Response.json({posts:[{id:'x',state:'QUEUE',integration:{id:pasara.integrationId}}]}))
      .mockResolvedValueOnce(Response.json([{postId:'x',integration:camp.integrationId}]))
      .mockResolvedValueOnce(new Response('API KEY secret',{status:500}));
    const gateway = new PostizDraftGateway('secret',undefined,fetcher);
    await expect(gateway.verifyBinding(pasara)).rejects.toThrow(/mismatch/);
    await expect(gateway.verifyBinding(pasara)).rejects.toThrow(/disabled/);
    await expect(gateway.verifyDraft(pasara,'x',new Date().toISOString())).rejects.toThrow(/not verified/);
    await expect(gateway.createDraft(pasara,payload)).rejects.toThrow(/Uncertain/);
    await expect(gateway.verifyBinding(pasara)).rejects.toThrow('Postiz unavailable (500)');
  });
  it('enforces principal grants and explicit workspace on HTTP mutations; exposes no schedule/publish route', async () => {
    const snapshot = vi.fn().mockResolvedValue({brand:pasara});
    const setDna = vi.fn(); const decide = vi.fn();
    const store = {brand:pasara,snapshot,setDna,decide,ready:async()=>true} as unknown as BrandStore;
    const gateway = {verifyBinding:vi.fn(),createDraft:vi.fn(),verifyDraft:vi.fn(),analytics:vi.fn()};
    const server = brandServer([new DraftService(store,gateway),new DraftService({brand:camp} as BrandStore,gateway)],[principal]);
    server.listen(0,'127.0.0.1'); await once(server,'listening');
    const address=server.address(); if(!address || typeof address==='string')throw Error('port');
    const url='http://127.0.0.1:'+address.port;
    const headers={Authorization:'Bearer '+token,'Content-Type':'application/json','X-Social-OS-Workspace':pasara.slug};
    try {
      expect((await fetch(url+'/api/workspaces')).status).toBe(401);
      const listed = await (await fetch(url+'/api/workspaces',{headers})).json() as {workspaces:Brand[]};
      expect(listed.workspaces).toEqual([pasara]);
      expect((await fetch(url+'/api/workspaces/runmycamp/snapshot',{headers})).status).toBe(404);
      expect((await fetch(url+'/api/workspaces/pasara-surf/snapshot',{headers})).status).toBe(200);
      const path=url+'/api/workspaces/pasara-surf/dna';
      expect((await fetch(path,{method:'POST',headers:{...headers,'X-Social-OS-Workspace':camp.slug},body:'{}'})).status).toBe(409);
      expect((await fetch(path,{method:'POST',headers:{...headers,Origin:'https://evil.example'},body:'{}'})).status).toBe(403);
      expect((await fetch(path,{method:'POST',headers,body:JSON.stringify({dna:{},version:0,workspace:camp.slug})})).status).toBe(400);
      expect(setDna).not.toHaveBeenCalled();
      expect((await fetch(path,{method:'POST',headers,body:JSON.stringify({dna:{},version:0})})).status).toBe(200);
      expect(setDna).toHaveBeenCalledWith({},0,'reviewer');
      for(const action of ['schedule','publish'])expect((await fetch(url+'/api/workspaces/pasara-surf/drafts/00000000-0000-4000-8000-000000000000/'+action,{method:'POST',headers,body:'{}'})).status).toBe(404);
      expect(gateway.createDraft).not.toHaveBeenCalled();
      expect((await fetch(path,{method:'POST',headers,body:'x'.repeat(65537)})).status).toBe(413);
    } finally { await new Promise<void>(resolve=>server.close(()=>resolve())); }
  });
});
