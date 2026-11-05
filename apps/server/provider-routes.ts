import type {FastifyInstance} from 'fastify';
import {credentialQuerySchema,modelQuerySchema,modelTypeSchema,taskQuerySchema,usageQuerySchema} from '../../packages/provider';
import type {Store} from './store';
import {createProviderService,type ProviderService} from './provider';
export function registerProviderRoutes(app:FastifyInstance,store:Store,provided?:ProviderService){
  const service=provided||createProviderService(store);
  // Explicit read requests only: no credentials or provider URLs accepted from the browser.
  app.get('/api/provider/balance',async request=>service.balance(credentialQuerySchema.parse(request.query).credentialId));
  app.get('/api/provider/key',async request=>service.keyInfo(credentialQuerySchema.parse(request.query).credentialId));
  app.get('/api/provider/usage',async request=>service.usage(usageQuerySchema.parse(request.query)));
  app.get('/api/provider/models',async request=>{const value=credentialQuerySchema.extend({type:modelTypeSchema.optional()}).parse(request.query);return service.models(value.credentialId,value.type);});
  app.get('/api/provider/model',async request=>{const value=modelQuerySchema.parse(request.query);return service.modelDetail(value.credentialId,value.model);});
  app.get('/api/provider/pricing',async request=>{const value=modelQuerySchema.parse(request.query);return service.modelPricing(value.credentialId,value.model,value.status);});
  app.get('/api/provider/task',async request=>{const value=taskQuerySchema.parse(request.query);return service.task(value.credentialId,value.taskId);});
  return service;
}
