import type {ProviderUsageRecord, UsageTotals} from './provider';

export type AccountBalance = {balance:number;unit:'算力';fetchedAt:string};
export type DailyConsumption = {date:string;cost:number|null;count:number};
export type AccountUsage = {
  from:string;to:string;fetchedAt:string;scope:'user';unit:'算力';
  totals:UsageTotals;daily:DailyConsumption[];
};
export type AccountRecords = {
  from:string;to:string;fetchedAt:string;records:ProviderUsageRecord[];
  total:number;limit:number;offset:number;
};
