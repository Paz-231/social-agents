import { once } from 'node:events';
import { brandServer } from '../src/deployment/brandServer.js';
import { describe,it,expect,vi } from 'vitest';
import { createPool } from '../src/deployment/postgres.js';
import { BrandStore } from '../src/deployment/brandStore.js';
import { DraftService } from '../src/deployment/draftService.js';
import type { Brand } from '../src/deployment/brands.js';
const url=process.env.TEST_DATABASE_URL;
const pasara:Brand={slug:'pasara-surf',name:'PASARA SURF',integrationId:'test-pasara',provider:'instagram'};
const camp:Brand={slug:'runmycamp',name:'RunMyCamp',integrationId:'test-camp',provider:'instagram-standalone'};
const dna={audience:'Test audience',voice:'Test voice',offer:'Test offer',rules:[],evidence:'Test fixture only'};
const media={id:'pasara-media',path:'https://uploads.postiz.com/test.jpg'};
const payload={caption:'Test draft',postType:'post',media:[media]};
describe.skipIf(!url)('multi-brand PostgreSQL lifecycle',()=>{
  it('isolates DNA, media, history, approvals and analytics; serializes exports; survives restart; reconciles only GET',async()=>{
    if (new URL(url!).pathname !== '/social_os_test') throw Error('Disposable social_os_test database required');
    let pool=createPool(url!);let a=new BrandStore(pool,pasara);let b=new BrandStore(pool,camp);
    const cleanup=async()=>{await pool.query('DELETE FROM social_os_events');await pool.query('DELETE FROM social_os_drafts');await pool.query('DELETE FROM social_os_assets');await pool.query('DELETE FROM social_os_brands');};
    try {
      // This suite requires an isolated disposable CI/test database. Never point TEST_DATABASE_URL at production.
      await a.migrate();await b.migrate();await cleanup();await a.migrate();await b.migrate();
      await a.setDna(dna,0,'alice');await b.setDna({...dna,voice:'Camp'},0,'bob');
      await expect(a.setDna(dna,0,'alice')).rejects.toThrow(/changed/);
      await a.addAsset(media,'Owned test fixture','alice');
      await expect(b.createDraft(payload,1,'bob')).rejects.toThrow(/Media/);
      const draft=await a.createDraft(payload,1,'alice');
      await expect(a.createDraft(payload,1,'alice')).rejects.toMatchObject({code:'23505'});
      await expect(b.decide(draft.id,1,'approved','bob')).rejects.toThrow(/not found/);
      await a.decide(draft.id,1,'approved','alice');
      await expect(a.decide(draft.id,1,'approved','alice')).rejects.toThrow(/changed/);
      const gateway={verifyBinding:vi.fn().mockResolvedValue(undefined),createDraft:vi.fn().mockResolvedValue('provider-test-id'),verifyDraft:vi.fn().mockRejectedValue(new Error('uncertain')),analytics:vi.fn().mockResolvedValue([{label:'Followers',data:[]}])};
      const service=new DraftService(a,gateway);
      const results=await Promise.allSettled([service.export(draft.id,2),service.export(draft.id,2)]);
      expect(results.every(r=>r.status==='rejected')).toBe(true);
      expect(gateway.createDraft).toHaveBeenCalledTimes(1);
      expect((await a.snapshot()).drafts[0]).toMatchObject({status:'exporting',provider_id:'provider-test-id'});
      expect((await b.snapshot()).drafts).toEqual([]);
      expect((await b.snapshot()).history.every(e=>e.actor==='bob')).toBe(true);
      await pool.end();pool=createPool(url!);a=new BrandStore(pool,pasara);b=new BrandStore(pool,camp);
      expect((await a.snapshot()).drafts).toHaveLength(1);
      gateway.verifyDraft.mockResolvedValue(undefined);
      await new DraftService(a,gateway).tick();
      expect(gateway.createDraft).toHaveBeenCalledTimes(1);
      expect((await a.snapshot()).drafts[0].status).toBe('exported');
      expect((await a.snapshot()).analytics).toHaveLength(1);
      expect((await b.snapshot()).analytics).toBeNull();expect(await a.ready()).toBe(true);expect(await b.ready()).toBe(false);
      const changed=await a.createDraft({...payload,caption:'Different'},1,'alice');await a.decide(changed.id,1,'approved','alice');
      await a.setDna({...dna,voice:'New voice'},1,'alice');
      await expect(a.claimExport(changed.id,2)).rejects.toThrow(/approval/);
      await expect(new BrandStore(pool,{...pasara,integrationId:'changed'}).snapshot()).rejects.toThrow(/binding mismatch/);
      const uncertain=await a.createDraft({...payload,caption:'Uncertain'},2,'alice');await a.decide(uncertain.id,1,'approved','alice');
      gateway.createDraft.mockRejectedValue(new Error('network uncertain'));
      await expect(new DraftService(a,gateway).export(uncertain.id,2)).rejects.toThrow(/uncertain/);
      await expect(new DraftService(a,gateway).export(uncertain.id,2)).rejects.toThrow(/approval/);
      expect((await a.snapshot()).drafts.find(d=>d.id===uncertain.id)).toMatchObject({status:'exporting',provider_id:null});
      await pool.query("UPDATE social_os_brands SET checked_at=now()-interval '5 minutes' WHERE workspace=$1",[pasara.slug]);expect(await a.ready()).toBe(false);
      // Complete HTTP -> authorization -> PostgreSQL -> draft-only gateway path for both brands.
      const httpGateway={verifyBinding:vi.fn().mockResolvedValue(undefined),createDraft:vi.fn().mockImplementation(async brand=>'http-'+brand.slug),verifyDraft:vi.fn().mockResolvedValue(undefined),analytics:vi.fn()};
      const token='h'.repeat(48);
      const server=brandServer([new DraftService(a,httpGateway),new DraftService(b,httpGateway)],[{id:'http-reviewer',token,workspaces:['pasara-surf','runmycamp']}]);
      server.listen(0,'127.0.0.1');await once(server,'listening');const address=server.address();if(!address||typeof address==='string')throw Error('port');
      try {
        for(const [brand,dnaVersion] of [[pasara,2],[camp,1]] as const){
          const endpoint='http://127.0.0.1:'+address.port+'/api/workspaces/'+brand.slug;
          const headers={Authorization:'Bearer '+token,'Content-Type':'application/json','X-Social-OS-Workspace':brand.slug};
          const post=async(path:string,data:unknown)=>fetch(endpoint+path,{method:'POST',headers,body:JSON.stringify(data)});
          const asset={id:'http-'+brand.slug,path:'https://uploads.postiz.com/'+brand.slug+'.jpg'};
          expect((await post('/assets',{asset,evidence:'HTTP test fixture'})).status).toBe(200);
          const created=await post('/drafts',{payload:{...payload,caption:'HTTP '+brand.slug,media:[asset]},dnaVersion});
          expect(created.status).toBe(201);const record=await created.json() as {id:string};
          expect((await post('/drafts/'+record.id+'/approve',{revision:1})).status).toBe(200);
          expect((await post('/drafts/'+record.id+'/export-draft',{revision:2})).status).toBe(200);
          expect((await post('/drafts/'+record.id+'/export-draft',{revision:2})).status).toBe(409);
          const snapshot=await (await fetch(endpoint+'/snapshot',{headers})).json() as {drafts:Array<{id:string;status:string}>};
          expect(snapshot.drafts.find(d=>d.id===record.id)?.status).toBe('exported');
        }
        expect(httpGateway.createDraft).toHaveBeenCalledTimes(2);
      } finally {await new Promise<void>(resolve=>server.close(()=>resolve()));}

    }finally {await cleanup();await pool.end();}
  });
});
