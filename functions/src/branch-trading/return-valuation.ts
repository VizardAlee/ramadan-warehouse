import { allocateTransport, receiptTransportShare } from "./landed-cost.js";
export interface ReturnReceiptCost {
  received: number; damaged: number; unitPriceMinor: number;
  source: readonly { quantity: number; companyMinor: number; managementMinor: number; serialId?: string }[];
  destination: readonly { quantity: number; companyMinor: number; managementMinor: number; serialId?: string }[];
}
const safe=(n:number)=>{if(!Number.isSafeInteger(n)||n<0)throw new Error("Original return cost evidence is invalid.");return n;};
/** Restore supplier managerial basis plus actual freight. Never refund freight or
 * duplicate its capitalization. Company carrying value remains the stock engine's
 * actual issue cost; any difference is explicit managerial valuation variance. */
export function originalReturnManagementCost(receipts:readonly ReturnReceiptCost[], received:number, returned:number, quantity:number, serialIds?:readonly string[], priorReturnedManagementMinor?:number) {
  let total=0,units=0; const serials:Record<string,number>={};
  for(const r of receipts){
    [r.received,r.damaged,r.unitPriceMinor].forEach(safe);units=safe(units+r.received);
    const sourceQty=r.source.reduce((sum,x)=>safe(sum+safe(x.quantity)),0),destQty=r.destination.reduce((sum,x)=>safe(sum+safe(x.quantity)),0);
    if(sourceQty!==r.received+r.damaged||destQty!==r.received)throw new Error("Original receipt quantities do not reconcile.");
    const sourceManagement=r.source.reduce((sum,x)=>safe(sum+safe(x.managementMinor)),0);
    r.source.forEach(x=>safe(x.companyMinor));r.destination.forEach(x=>{safe(x.companyMinor);safe(x.managementMinor);});
    const freight=safe(r.destination.reduce((sum,x)=>safe(sum+x.managementMinor),0)-safe(r.unitPriceMinor*r.received));
    if(serialIds){
      for(const d of r.destination){
        if(!d.serialId||d.quantity!==1||serials[d.serialId]!==undefined)throw new Error("Original serial cost evidence is ambiguous.");
        const source=r.source.filter(s=>s.serialId===d.serialId);
        if(source.length!==1||source[0]!.quantity!==1)throw new Error("Original serial source cost is missing.");
        serials[d.serialId]=safe(source[0]!.managementMinor+safe(d.managementMinor-r.unitPriceMinor));
      }
    } else total=safe(total+allocateTransport(sourceManagement,[{id:"good",weight:r.received},{id:"damaged",weight:r.damaged}]).good!+freight);
  }
  if(units!==received||!Number.isSafeInteger(quantity)||quantity<=0||returned+quantity>received)throw new Error("Original invoice receipt evidence is incomplete.");
  if(serialIds){
    if(serialIds.length!==quantity||new Set(serialIds).size!==quantity||serialIds.some(id=>serials[id]===undefined))throw new Error("Return serials were not received on this invoice.");
    const values=Object.fromEntries(serialIds.map(id=>[id,serials[id]!]));
    return {valueMinor:safe(Object.values(values).reduce((a,b)=>a+b,0)),serialValues:values};
  }
  const prior = priorReturnedManagementMinor ?? (returned === 0 ? 0 : NaN);
  safe(prior);
  if (prior > total || (returned === 0 && prior !== 0)) throw new Error("Previously returned managerial cost is inconsistent.");
  return {valueMinor:receiptTransportShare(total-prior,received-returned,0,quantity),serialValues:undefined};
}
