// Contract package / quotation PDF.
//
// Security model: the browser sends only { estimateId, includeTerms } plus its
// access token. Everything printed -- homeowner, amounts, scopes, and whether
// the document says "DRAFT" -- is loaded here with the caller's own RLS scope
// and derived from the saved estimate, so a caller cannot produce a
// signature-ready document for an unapproved or altered estimate.
import { NextRequest, NextResponse } from "next/server";
import { PDFDocument, PDFPage, PDFFont, StandardFonts, rgb } from "pdf-lib";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { EstimateLineItem } from "@/components/estimator/estimate-cost-editor";
import { buildQuotationScopes, contractPackageProblem, isReleasedEstimate, type ContractPackage, type ProgramTrack } from "@/lib/contract-package";
import { requireOpsHubUser } from "@/lib/supabase-server";
import { formatClientDate } from "@/lib/timezone";

const UUID=/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
type Project={homeowner_name:string|null;address_line1:string|null;address_line2:string|null;phone:string|null;email:string|null};

const ink=rgb(.25,.25,.25),border=rgb(.48,.48,.48),cream=rgb(1,.95,.78),orange=rgb(1,.46,0);
const money=(n:number)=>new Intl.NumberFormat("en-US",{style:"currency",currency:"USD"}).format(n||0);
function wrap(text:string,font:PDFFont,size:number,width:number){
 const rows:string[]=[];
 for(const paragraph of String(text||"").split(/\r?\n/)){
  let row="";
  for(const word of paragraph.trim().split(/\s+/).filter(Boolean)){
   if(row && font.widthOfTextAtSize(row+" "+word,size)>width){rows.push(row);row="";}
   for(const character of (row?" ":"")+word){if(row && font.widthOfTextAtSize(row+character,size)>width){rows.push(row);row="";}row+=character;}
  }
  rows.push(row);
 }
 return rows;
}
function cell(page:PDFPage,value:string,x:number,top:number,width:number,height:number,font:PDFFont,size=8,align:"left"|"right"="left",fill=false){if(fill)page.drawRectangle({x,y:top-height,width,height,color:cream});page.drawRectangle({x,y:top-height,width,height,borderColor:border,borderWidth:.55});wrap(value,font,size,width-6).slice(0,Math.max(1,Math.floor((height-4)/(size+1)))).forEach((row,i)=>{const tx=align==="right"?x+width-3-font.widthOfTextAtSize(row,size):x+3;page.drawText(row,{x:tx,y:top-3-size-i*(size+1),size,font,color:ink});});}

async function renderContractPackagePdf(data:ContractPackage,includeTerms:boolean):Promise<Uint8Array>{
  const pdf=await PDFDocument.create(),regular=await pdf.embedFont(StandardFonts.Helvetica),bold=await pdf.embedFont(StandardFonts.HelveticaBold);
  let page=pdf.addPage([612,792]),y=748;
  const draw=(value:string,x:number,size=9,font=regular,color=ink)=>page.drawText(value,{x,y,size,font,color});
  const fresh=()=>{page=pdf.addPage([612,792]);y=748;};
  draw(data.draft?"DRAFT ESTIMATE":"ESTIMATE",72,16,regular,orange);y-=20;draw("Stonebridge Home Energy Solutions",72,9,bold);draw("accounts@stonebridge.example",282,9);y-=12;draw("4820 Meridian Park Dr, Suite 210",72,9);draw("+1 (804) 555-0148",282,9);y-=12;draw("Richmond, VA 23230",72,9);
  page.drawText("STONEBRIDGE",{x:540-bold.widthOfTextAtSize("STONEBRIDGE",13),y:722,size:13,font:bold,color:rgb(.03,.55,.65)});
  y-=34;draw(`SERO Energy Rebate Program - ${data.programTrack}`,151,11,bold);y-=27;
  draw("Prepared for",72,9,bold);y-=12;draw(data.homeowner||"Customer Name",72,9);y-=12;
  for(const row of wrap(data.address||"Address",regular,9,300)){draw(row,72,9);y-=11}
  if(data.phone){draw(data.phone,72,9);y-=11}if(data.email){draw(data.email,72,9);y-=11}
  y-=14;draw("Estimate Details",72,9,bold);y-=12;for(const row of wrap(`Estimate No: ${data.estimateNumber}`,regular,9,490)){draw(row,72,9);y-=12}draw(`Estimate Date: ${data.estimateDate}`,72,9);y-=20;

  const cols=[72,140,280,493];cell(page,"#",cols[0],y,68,14,regular,8,"left",true);cell(page,"Product or Service",cols[1],y,140,14,regular,8,"left",true);cell(page,"Description",cols[2],y,213,14,regular,8,"left",true);cell(page,"Amount",cols[3],y,73,14,regular,8,"left",true);y-=14;
  const tableRow=(number:string,name:string,description:string,amount:string)=>{
   const names=wrap(name,regular,8,134),details=wrap(description,regular,8,207);let offset=0;
   const count=Math.max(names.length,details.length);
   while(offset<count){
    if(y<150)fresh();
    const take=Math.min(count-offset,Math.max(1,Math.floor((y-120-6)/9)));
    const height=Math.max(24,take*9+6);
    cell(page,offset===0?number:number+" cont.",cols[0],y,68,height,regular,8,"right");
    cell(page,names.slice(offset,offset+take).join("\n"),cols[1],y,140,height,regular);
    cell(page,details.slice(offset,offset+take).join("\n"),cols[2],y,213,height,regular);
    cell(page,offset+take>=count?amount:"",cols[3],y,73,height,regular,8,"right");
    y-=height;offset+=take;
   }
  };
  for(const scope of data.scopes){tableRow(scope.number,scope.name,scope.description,"");
   for(const item of scope.children)tableRow(item.number,item.name,item.description,money(item.amount));
   if(y-14<120)fresh();cell(page,"Subtotal",cols[0],y,208,14,bold);cell(page,"",cols[2],y,213,14,regular);cell(page,money(scope.subtotal),cols[3],y,73,14,bold,8,"right");y-=14;
  }
  if(y<190)fresh();const tx=367,tw=126,vw=73;for(const [label,value,minH] of [["Total Project Cost",money(data.total),18],[`Less: ${data.programTrack} Rebate`,money(data.rebate),18],["Homeowner Out-of-Pocket",money(data.outOfPocket),27]] as [string,string,number][]){cell(page,label,tx,y,tw,minH,bold,8,"left",true);cell(page,value,tx+tw,y,vw,minH,bold,8,"right",true);y-=minH;}y-=25;
  const note=includeTerms?"Note: Unforeseen site conditions or hidden safety hazards discovered during the work may require additional out-of-pocket costs to safely resolve. To qualify for the program rebate, the entire agreed-upon Scope of Work must be completed. The homeowner understands that if they choose to cancel the project mid-construction rather than address these required conditions, they may be held directly financially responsible for all costs incurred up to the date of cancellation. Please review the attached Terms of Service for full details.":"For homeowner information and discussion. This quotation does not include the Terms of Service. Request the complete quotation and Terms package before signing. Unapproved drafts remain subject to staff review.";const noteRows=wrap(note,regular,8,410),nh=noteRows.length*9+8;if(y-nh<65)fresh();page.drawRectangle({x:72,y:y-nh,width:420,height:nh,borderColor:ink,borderWidth:.7});noteRows.forEach((r,i)=>page.drawText(r,{x:75,y:y-11-i*9,size:8,font:regular,color:ink}));y-=nh+27;if(includeTerms){draw("Customer Signature:",72,9,bold);page.drawLine({start:{x:235,y:y-1},end:{x:385,y:y-1},thickness:.6,color:ink});y-=28;draw("Date:",72,9,bold);page.drawLine({start:{x:235,y:y-1},end:{x:385,y:y-1},thickness:.6,color:ink});
  }
  if(includeTerms){const terms=await readFile(path.join(process.cwd(),"public","legal","Sample-Terms-of-Service.pdf"));const termsPdf=await PDFDocument.load(terms),copied=await pdf.copyPages(termsPdf,termsPdf.getPageIndices());copied.forEach(p=>pdf.addPage(p));}
  return pdf.save();
}

export async function POST(request:NextRequest){
  const guard=await requireOpsHubUser(request);
  if(!guard.ok)return guard.response;
  const body=await request.json().catch(()=>null) as {estimateId?:unknown;includeTerms?:unknown}|null;
  if(!body||typeof body.estimateId!=="string"||!UUID.test(body.estimateId))return NextResponse.json({error:"Invalid estimate id"},{status:400});
  if(body.includeTerms!==undefined&&typeof body.includeTerms!=="boolean")return NextResponse.json({error:"Invalid download type"},{status:400});
  const includeTerms=body.includeTerms!==false;
  try{
    const {db}=guard;
    const {data:estimate,error:estimateError}=await db.from("estimates")
      .select("id, estimate_number, program_track, status, total_project_cost, rebate_amount, homeowner_out_of_pocket, projects(homeowner_name, address_line1, address_line2, phone, email)")
      .eq("id",body.estimateId).maybeSingle();
    if(estimateError)throw estimateError;
    if(!estimate)return NextResponse.json({error:"Estimate not found"},{status:404});
    const [{data:lines,error:linesError},{data:assumptions,error:assumptionsError}]=await Promise.all([
      db.from("estimate_line_items").select("*").eq("estimate_id",estimate.id),
      db.from("estimate_pricing_assumptions").select("labor_split_percent").eq("estimate_id",estimate.id).maybeSingle(),
    ]);
    if(linesError)throw linesError;
    if(assumptionsError)throw assumptionsError;
    const project=(Array.isArray(estimate.projects)?estimate.projects[0]:estimate.projects) as Project|null;
    const pkg:ContractPackage={
      estimateNumber:estimate.estimate_number,
      estimateDate:formatClientDate(new Date().toISOString()),
      programTrack:estimate.program_track as ProgramTrack,
      homeowner:project?.homeowner_name||"Customer Name",
      address:[project?.address_line1,project?.address_line2].filter(Boolean).join(", "),
      phone:project?.phone,
      email:project?.email,
      total:Number(estimate.total_project_cost??0),
      rebate:Number(estimate.rebate_amount??0),
      outOfPocket:Number(estimate.homeowner_out_of_pocket??0),
      scopes:buildQuotationScopes((lines??[]) as EstimateLineItem[],estimate.id,Number(assumptions?.labor_split_percent??40)),
      draft:!isReleasedEstimate(estimate.status),
    };
    const problem=contractPackageProblem(pkg);
    if(problem)return NextResponse.json({error:problem},{status:422});
    const bytes=await renderContractPackagePdf(pkg,includeTerms);
    const fileNumber=pkg.estimateNumber.replace(/[^A-Za-z0-9._-]/g,"-");
    return new NextResponse(Buffer.from(bytes),{headers:{"Content-Type":"application/pdf","Content-Disposition":`attachment; filename="${fileNumber}-${pkg.programTrack}-${includeTerms?"Contract-Package":"Quotation"}.pdf"`,"Cache-Control":"no-store"}});
  }catch(error){
    // Details go to the server log only; the caller gets a generic message.
    console.error("contract-package generation failed",error);
    return NextResponse.json({error:"Unable to generate the estimate package. Try again."},{status:500});
  }
}
