import {useCallback,useSyncExternalStore} from 'react';

export function useMediaQuery(query:string){
  return useSyncExternalStore(
    useCallback((onChange:()=>void)=>{const media=window.matchMedia(query);media.addEventListener('change',onChange);return()=>media.removeEventListener('change',onChange);},[query]),
    ()=>window.matchMedia(query).matches,
    ()=>false,
  );
}
