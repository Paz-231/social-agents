import type { BrandStore } from './brandStore.js';
import type { Brand } from './brands.js';
import { RequestError } from './brands.js';

/** This capability has no method for scheduling, publishing, deleting or changing post status. */
export interface DraftGateway {
  verifyBinding(brand: Brand): Promise<void>;
  createDraft(brand: Brand, payload: unknown): Promise<string>;
  verifyDraft(brand: Brand, id: string, at: string): Promise<void>;
  analytics(brand: Brand): Promise<unknown>;
}
export class DraftService {
  constructor(readonly store: BrandStore, readonly gateway: DraftGateway) {}
  async export(id: string, revision: number) {
    // Read-only verification before the durable claim. Never retry an uncertain POST.
    await this.gateway.verifyBinding(this.store.brand);
    const payload = await this.store.claimExport(id, revision);
    const at = new Date().toISOString();
    const providerId = await this.gateway.createDraft(this.store.brand, payload);
    await this.store.recordExportId(id, providerId);
    await this.gateway.verifyDraft(this.store.brand, providerId, at);
    await this.store.confirmExport(id);
  }
  async tick() {
    try {
      await this.gateway.verifyBinding(this.store.brand);
      for (const item of await this.store.pendingReconciliation()) {
        await this.gateway.verifyDraft(this.store.brand, item.provider_id, new Date(item.export_started_at).toISOString());
        await this.store.confirmExport(item.id);
      }
      // A heartbeat means channel verification succeeded. Analytics failure retains the old timestamp.
      await this.store.heartbeat(true);
      if (Date.now() - this.lastAnalytics >= 15 * 60_000) {
        const data = await this.gateway.analytics(this.store.brand);
        await this.store.heartbeat(true, data);
        this.lastAnalytics = Date.now();
      }
    } catch {
      await this.store.heartbeat(false);
      throw new RequestError(503, 'Brand monitor failed');
    }
  }
  private lastAnalytics = 0;
}
