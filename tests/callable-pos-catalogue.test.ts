import { initializeApp, deleteApp, type FirebaseApp } from "firebase/app";
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword } from "firebase/auth";
import { getFunctions, connectFunctionsEmulator, httpsCallable } from "firebase/functions";
import { getApps, initializeApp as adminApp } from "firebase-admin/app";
import { getAuth as adminAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { balanceDocumentId, uniquenessDocumentId } from "../functions/src/inventory/calculations";
const projectId = process.env.TEST_FIREBASE_PROJECT_ID ?? "demo-ramadan-warehouse";
const enabled = projectId.startsWith("demo-") && /^127\.0\.0\.1:/.test(process.env.FIRESTORE_EMULATOR_HOST ?? "") && /^127\.0\.0\.1:/.test(process.env.FIREBASE_AUTH_EMULATOR_HOST ?? "");
const apps: FirebaseApp[] = [];
afterAll(async () => { await Promise.all(apps.map(deleteApp)); });
describe.skipIf(!enabled)("complete POS catalogue callable", () => {
  const org = "catalogue-complete-org", branch = "catalogue-complete-branch", location = "catalogue-complete-stock";
  const admin = getApps().find(a => a.name === "catalogue-complete") ?? adminApp({ projectId }, "catalogue-complete");
  const db = getFirestore(admin);
  let call: (data: object) => Promise<{data: {products: {id: string; availableQuantity: number; unitPriceMinor: number}[]}}>;
  beforeAll(async () => {
    await db.doc(`organizations/${org}`).set({status:"active"});
    await db.doc(`branches/${branch}`).set({organizationId:org,status:"active",name:"Civic",code:"CC",branchType:"store"});
    await db.doc(`inventoryLocations/${location}`).set({organizationId:org,branchId:branch,type:"branch",status:"active",name:"Civic Stock"});
    const email="catalogue-check@example.invalid", password="Synthetic-only-234567!";
    const record=await adminAuth(admin).createUser({email,password});
    await db.doc(`users/${record.uid}`).set({organizationId:org,displayName:"Catalogue cashier",roleId:"sales_cashier",roleIds:["sales_cashier"],branchIds:[branch],warehouseIds:[],status:"active",authDisabled:false,authorizationVersion:1,effectivePermissions:["sales.read.own_branch"]});
    let batch=db.batch(), pending=0;
    for(let n=0;n<503;n++) {
      const id=`catalogue-check-${String(n).padStart(4,"0")}`;
      batch.set(db.doc(`products/${id}`),{organizationId:org,active:true,name:n===502?"Lithium 8kwh Haisic wall mount":`Product${n}`,sku:id,unitOfMeasure:"unit",trackingType:"quantity"});
      batch.set(db.doc(`productSalesPrices/${id}`),{organizationId:org,productId:id,active:true,basePriceMinor:10000,version:1,vatRateBasisPoints:null});
      pending+=2;if(pending>=400){await batch.commit();batch=db.batch();pending=0;}
    }
    if(pending)await batch.commit();
    const id="catalogue-check-0502";
    await db.doc(`branchSalesPrices/${uniquenessDocumentId(org,"branchSalesPrice",branch,id)}`).set({organizationId:org,branchId:branch,productId:id,active:true,sellingPriceMinor:12000,wholesalePriceMinor:11000,version:1,basePriceVersion:1});
    await db.doc(`inventoryBalances/${balanceDocumentId(org,id,location)}`).set({organizationId:org,locationId:location,productId:id,availableQuantity:1,quantity:1});
    const app=initializeApp({projectId,apiKey:"demo",appId:"catalogue-check"},"catalogue-check-client");apps.push(app);
    const auth=getAuth(app);connectAuthEmulator(auth,`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`,{disableWarnings:true});
    const fn=getFunctions(app,"us-central1");connectFunctionsEmulator(fn,"127.0.0.1",Number(process.env.TEST_FUNCTIONS_PORT??5001));
    await signInWithEmailAndPassword(auth,email,password);call=httpsCallable<object,{products:{id:string;availableQuantity:number;unitPriceMinor:number}[]}>(fn,"getPosWorkspace");
  },120000);
  it("returns later products with correct branch prices and availability even with legacy limit200",async()=>{
    const result=(await call({branchId:branch,limit:200})).data;
    expect(result.products).toHaveLength(503);
    expect(result.products.find(p=>p.id==="catalogue-check-0502")).toMatchObject({availableQuantity:1,unitPriceMinor:12000});
  },120000);
  it("preserves branch restrictions",async()=>{
    await expect(call({branchId:"other-branch"})).rejects.toMatchObject({code:"functions/permission-denied"});
  });
});
