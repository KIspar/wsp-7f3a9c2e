export const relayIds=['chuhe','token01'] as const;
export type RelayId=typeof relayIds[number];
export type RelayBalance={balance:number;unit:string;fetchedAt:string};
export type Token01AccountState={authenticated:boolean;phone?:string;loggedAt?:string;revision?:string;expired?:boolean};
export type Token01LoginConfig={phoneEnabled:boolean;captchaEnabled:boolean;captchaAppId?:string};
export type RelayCatalogModel={id:string;name:string;upstreamId:string;category:string;localId?:string;available:boolean;groups:{id:string;name:string;status:import('./chuhe-routing').ChuheChannelStatus;forced:boolean}[]};
export type RelayCatalog={models:RelayCatalogModel[];groupCount:number;custom:boolean;fetchedAt:string};
export type RelayState={
  id:RelayId;name:string;configured:boolean;status:'unconfigured'|'idle'|'ready'|'error';
  modelIds:string[];discovered:number;checkedAt?:string;error?:string;groupCredentialCount?:number;
};
export const relayPortals:Record<RelayId,{keys:string;wallet:string;usage:string;pricing:string}>={
  chuhe:{keys:'https://chuhe.lk888.ai/api/console/keys',wallet:'https://chuhe.lk888.ai/api/wode',usage:'https://chuhe.lk888.ai/api/console/usage',pricing:'https://chuhe.lk888.ai/api/pricing'},
  token01:{keys:'https://www.token01.net/keys',wallet:'https://www.token01.net/wallet',usage:'https://www.token01.net/usage-logs/common',pricing:'https://www.token01.net/pricing'},
};
