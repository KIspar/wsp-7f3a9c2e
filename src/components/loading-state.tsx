import {LoaderCircle} from 'lucide-react';
import {cn} from '@/lib/utils';

/** Loading feedback is centered within the region it describes. */
export function LoadingState({label,placement='block',className}:{label:string;placement?:'block'|'inline';className?:string}){
 return <div className={cn('loading-state',placement==='block'&&'loading-state-block',className)} role="status" aria-live="polite" aria-busy="true"><LoaderCircle className="spin" aria-hidden="true"/><span>{label}</span></div>;
}
