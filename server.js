"use strict";
require("dotenv").config();
const express=require("express");
const multer=require("multer");
const crypto=require("crypto");
const path=require("path");
const {createClient}=require("@supabase/supabase-js");

const app=express();
const PORT=process.env.PORT||3000;
const PUBLIC=path.join(__dirname,"public");
const SUPABASE_URL=process.env.SUPABASE_URL;
const PUBLISHABLE=process.env.SUPABASE_PUBLISHABLE_KEY;
const SECRET=process.env.SUPABASE_SECRET_KEY;
if(!SUPABASE_URL||!PUBLISHABLE||!SECRET)console.warn("Supabase environment variables are incomplete.");

const authClient=createClient(SUPABASE_URL,PUBLISHABLE,{auth:{persistSession:false,autoRefreshToken:false}});
const db=createClient(SUPABASE_URL,SECRET,{auth:{persistSession:false,autoRefreshToken:false}});
const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:5*1024*1024},fileFilter:(_,f,cb)=>cb(null,["image/png","image/jpeg"].includes(f.mimetype))});

app.use(express.json({limit:"1mb"}));
app.use(express.static(PUBLIC));

const parseCookies=req=>Object.fromEntries(String(req.headers.cookie||"").split(";").map(x=>x.trim()).filter(Boolean).map(x=>{const i=x.indexOf("=");return[decodeURIComponent(x.slice(0,i)),decodeURIComponent(x.slice(i+1))]}));
function cookie(name,value,maxAge){return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${process.env.NODE_ENV==="production"?"; Secure":""}`;}
function setAuthCookies(res,session){res.setHeader("Set-Cookie",[cookie("rsr_access",session.access_token,session.expires_in||3600),cookie("rsr_refresh",session.refresh_token,30*24*3600)]);}
function clearAuthCookies(res){res.setHeader("Set-Cookie",[cookie("rsr_access","",0),cookie("rsr_refresh","",0)]);}
async function getAuth(req,res){
  const c=parseCookies(req);let access=c.rsr_access;
  if(access){const {data}=await authClient.auth.getUser(access);if(data.user)return{user:data.user,access};}
  if(c.rsr_refresh){const {data,error}=await authClient.auth.refreshSession({refresh_token:c.rsr_refresh});if(!error&&data.session){setAuthCookies(res,data.session);return{user:data.user,access:data.session.access_token};}}
  return null;
}
async function requireUser(req,res,next){const a=await getAuth(req,res);if(!a)return res.status(401).json({error:"Login required."});req.user=a.user;req.accessToken=a.access;next();}
function admin(req,res,next){if(!process.env.ADMIN_KEY||req.get("x-admin-key")!==process.env.ADMIN_KEY)return res.status(401).json({error:"Invalid admin key."});next();}
const orderNumber=()=>`RSR-${new Date().toISOString().slice(0,10).replaceAll("-","")}-${crypto.randomInt(1000,9999)}`;
const baseUrl=req=>process.env.PUBLIC_BASE_URL||`${req.protocol}://${req.get("host")}`;
async function discord(payload){if(!process.env.DISCORD_WEBHOOK_URL)return;try{await fetch(process.env.DISCORD_WEBHOOK_URL,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});}catch(e){console.error("Discord:",e.message);}}
async function releaseExpired(){await db.rpc("release_expired_reservations");}
async function signedReceipt(pathValue){if(!pathValue)return null;const {data}=await db.storage.from("payment-receipts").createSignedUrl(pathValue,3600);return data?.signedUrl||null;}
async function profileName(user){const {data}=await db.from("profiles").select("full_name").eq("id",user.id).maybeSingle();return data?.full_name||user.user_metadata?.full_name||"Customer";}

app.get("/api/public-config",(req,res)=>res.json({supabaseUrl:SUPABASE_URL,supabasePublishableKey:PUBLISHABLE}));
app.post("/api/auth/register",async(req,res)=>{
  const name=String(req.body.name||"").trim(),email=String(req.body.email||"").trim().toLowerCase(),password=String(req.body.password||"");
  if(name.length<2||password.length<8)return res.status(400).json({error:"Enter a name and password of at least 8 characters."});
  const {data,error}=await authClient.auth.signUp({email,password,options:{data:{full_name:name},emailRedirectTo:`${baseUrl(req)}/auth.html?verified=1`}});
  if(error)return res.status(400).json({error:error.message});
  if(data.session)setAuthCookies(res,data.session);
  res.status(201).json({message:data.session?"Account created.":"Check your email to verify your account."});
});
app.post("/api/auth/login",async(req,res)=>{
  const {data,error}=await authClient.auth.signInWithPassword({email:String(req.body.email||"").trim(),password:String(req.body.password||"")});
  if(error)return res.status(401).json({error:error.message});setAuthCookies(res,data.session);res.json({ok:true});
});
app.post("/api/auth/logout",async(req,res)=>{const c=parseCookies(req);if(c.rsr_access)await authClient.auth.admin?.signOut?.(c.rsr_access);clearAuthCookies(res);res.json({ok:true});});
app.get("/api/auth/me",requireUser,async(req,res)=>res.json({user:{id:req.user.id,email:req.user.email,name:await profileName(req.user)}}));
app.post("/api/auth/forgot-password",async(req,res)=>{const {error}=await authClient.auth.resetPasswordForEmail(String(req.body.email||"").trim(),{redirectTo:`${baseUrl(req)}/reset-password.html`});if(error)return res.status(400).json({error:error.message});res.json({message:"Password reset email sent."});});


app.get("/api/support-status",async(req,res)=>{const {data}=await db.from("admin_presence").select("*").eq("id",1).single();res.json({isOnline:!!data?.is_online,statusText:data?.status_text||"Support is offline"});});
app.get("/api/promo/:code",async(req,res)=>{
  const code=String(req.params.code||"").trim().toUpperCase();
  const {data,error}=await db.from("promo_codes").select("*").eq("code",code).eq("active",true).maybeSingle();
  if(error||!data)return res.status(404).json({error:"Promo code is invalid."});
  if(data.expires_at&&new Date(data.expires_at)<=new Date())return res.status(400).json({error:"Promo code has expired."});
  if(data.usage_limit!==null&&Number(data.used_count)>=Number(data.usage_limit))return res.status(400).json({error:"Promo code usage limit reached."});
  res.json({code:data.code,discountPercent:Number(data.discount_percent)});
});

app.get("/api/settings",async(req,res)=>{await releaseExpired();const {data,error}=await db.from("store_settings").select("*").eq("id",1).single();if(error)return res.status(500).json({error:error.message});res.json({...data,available_stock:Number(data.instant_stock)-Number(data.instant_reserved)});});
app.get("/api/roblox/search",async(req,res)=>{const username=String(req.query.username||"").trim();if(username.length<3)return res.status(400).json({error:"Enter an exact Roblox username."});try{const ur=await fetch("https://users.roblox.com/v1/usernames/users",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({usernames:[username],excludeBannedUsers:true})});const ud=await ur.json(),u=ud.data?.[0];if(!u)return res.status(404).json({error:"Roblox account not found."});const tr=await fetch(`https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${u.id}&size=150x150&format=Png&isCircular=false`),td=await tr.json();res.json({userId:u.id,username:u.name,displayName:u.displayName,avatarUrl:td.data?.[0]?.imageUrl||""});}catch(e){res.status(502).json({error:"Roblox lookup failed."});}});

app.post("/api/orders",requireUser,upload.single("receipt"),async(req,res)=>{
  if(!req.file)return res.status(400).json({error:"Receipt is required."});
  const b=req.body,amount=Number(b.amount)||0,n=orderNumber(),token=crypto.randomBytes(24).toString("hex"),ext=req.file.mimetype==="image/png"?"png":"jpg",receiptPath=`${req.user.id}/${n}-${crypto.randomBytes(5).toString("hex")}.${ext}`;
  let originalPayment=Number(b.originalPayment)||Number(b.payment)||0,discountAmount=0,finalPayment=originalPayment,promoCode=null,promoRow=null;
  if(String(b.promoCode||"").trim()){
    const code=String(b.promoCode).trim().toUpperCase();
    const {data}=await db.from("promo_codes").select("*").eq("code",code).eq("active",true).maybeSingle();
    if(!data||data.expires_at&&new Date(data.expires_at)<=new Date()||data.usage_limit!==null&&Number(data.used_count)>=Number(data.usage_limit))return res.status(400).json({error:"Promo code is no longer valid."});
    promoRow=data;promoCode=code;discountAmount=originalPayment*(Number(data.discount_percent)/100);finalPayment=Math.max(0,originalPayment-discountAmount);
  }
  const {error:upErr}=await db.storage.from("payment-receipts").upload(receiptPath,req.file.buffer,{contentType:req.file.mimetype,upsert:false});if(upErr)return res.status(500).json({error:"Receipt upload failed: "+upErr.message});
  const row={order_number:n,customer_id:req.user.id,access_token:token,status:"Pending Payment Review",method:b.method,tax_option:b.taxOption||"N/A",amount,receive_amount:Number(b.receiveAmount)||0,required_pass_price:Number(b.requiredPassPrice)||0,payment:Number(finalPayment.toFixed(2)),original_payment:Number(originalPayment.toFixed(2)),discount_amount:Number(discountAmount.toFixed(2)),promo_code:promoCode,payment_method:b.paymentMethod,sender_name:b.senderName,reference_number:b.referenceNumber,roblox_user_id:String(b.robloxUserId),roblox_username:b.username,roblox_display_name:b.robloxDisplayName,roblox_avatar_url:b.robloxAvatarUrl||null,game_name:b.gameName||null,item_name:b.itemName||null,gift_details:b.giftDetails||null,receipt_path:receiptPath};
  const {data:order,error}=await db.from("orders").insert(row).select().single();if(error){await db.storage.from("payment-receipts").remove([receiptPath]);return res.status(400).json({error:error.message});}
  if(promoRow)await db.from("promo_codes").update({used_count:Number(promoRow.used_count)+1}).eq("id",promoRow.id);
  if(b.method==="Robux Instant"){const {error:rErr}=await db.rpc("reserve_instant_stock",{p_order_id:order.id,p_amount:amount});if(rErr){await db.from("orders").delete().eq("id",order.id);await db.storage.from("payment-receipts").remove([receiptPath]);return res.status(409).json({error:rErr.message});}}
  await db.from("order_status_history").insert({order_id:order.id,status:"Pending Payment Review",changed_by:"customer"});
  if(b.method==="In-Game Gifting")await db.from("order_messages").insert({order_id:order.id,sender_role:"system",message:"Use this private chat to confirm the exact game, item, schedule, and gifting requirements.",read_by_admin:true});
  await db.from("saved_roblox_accounts").upsert({customer_id:req.user.id,roblox_user_id:String(b.robloxUserId),username:b.username,display_name:b.robloxDisplayName,avatar_url:b.robloxAvatarUrl||null},{onConflict:"customer_id,roblox_user_id"});
  const chatUrl=`${baseUrl(req)}/status.html?order=${encodeURIComponent(n)}&token=${encodeURIComponent(token)}`;
  await discord({embeds:[{title:"New RSR Order",color:9442302,fields:[{name:"Order",value:n},{name:"Account",value:`${b.robloxDisplayName} (@${b.username})`},{name:"Method",value:`${b.method}${b.taxOption!=="N/A"?` — ${b.taxOption}`:""}`},{name:"Payment",value:`₱${Number(b.payment).toFixed(2)} via ${b.paymentMethod}`},{name:"Private Link",value:chatUrl}],timestamp:new Date().toISOString()}]});
  res.json({orderNumber:n,chatUrl});
});

app.get("/api/orders/:number",async(req,res)=>{
  const {data:o,error}=await db.from("orders").select("*").eq("order_number",req.params.number).eq("access_token",String(req.query.token||"")).maybeSingle();if(error||!o)return res.status(403).json({error:"Invalid order number or private token."});
  await db.from("order_messages").update({read_by_customer:true}).eq("order_id",o.id).eq("sender_role","admin");
  const [{data:messages},{data:history}]=await Promise.all([db.from("order_messages").select("*").eq("order_id",o.id).order("created_at"),db.from("order_status_history").select("*").eq("order_id",o.id).order("created_at")]);
  res.json({...o,messages:messages||[],history:history||[]});
});
app.post("/api/orders/:number/messages",async(req,res)=>{
  const {data:o}=await db.from("orders").select("id,customer_id,roblox_display_name,roblox_username").eq("order_number",req.params.number).eq("access_token",String(req.body.token||"")).maybeSingle();if(!o)return res.status(403).json({error:"Invalid private token."});const text=String(req.body.text||"").trim().slice(0,1500);if(!text)return res.status(400).json({error:"Message is empty."});
  await db.from("order_messages").insert({order_id:o.id,sender_role:"customer",sender_id:o.customer_id,message:text,read_by_customer:true,read_by_admin:false});await discord({embeds:[{title:`Customer Message — ${req.params.number}`,description:text,color:3447003}]});res.json({ok:true});
});

app.get("/api/dashboard",requireUser,async(req,res)=>{
  const name=await profileName(req.user);const {data:orders}=await db.from("orders").select("*").eq("customer_id",req.user.id).order("created_at",{ascending:false});
  const ids=(orders||[]).map(o=>o.id);let unreadRows=[],reviews=[];if(ids.length){({data:unreadRows}=await db.from("order_messages").select("order_id").in("order_id",ids).eq("sender_role","admin").eq("read_by_customer",false));({data:reviews}=await db.from("reviews").select("order_id").eq("customer_id",req.user.id));}
  const unreadMap={};(unreadRows||[]).forEach(m=>unreadMap[m.order_id]=(unreadMap[m.order_id]||0)+1);const reviewed=new Set((reviews||[]).map(r=>r.order_id));
  const mapped=(orders||[]).map(o=>({...o,unread_count:unreadMap[o.id]||0,has_review:reviewed.has(o.id),chat_url:`/status.html?order=${encodeURIComponent(o.order_number)}&token=${encodeURIComponent(o.access_token)}`}));
  const active=mapped.filter(o=>!["Completed","Declined"].includes(o.status)).length,completed=mapped.filter(o=>o.status==="Completed").length,spent=mapped.filter(o=>!["Declined"].includes(o.status)).reduce((s,o)=>s+Number(o.payment),0);
  res.json({user:{name,email:req.user.email},orders:mapped,unreadMessages:Object.values(unreadMap).reduce((a,b)=>a+b,0),stats:{total:mapped.length,active,completed,spent}});
});
app.get("/api/account/unread-count",requireUser,async(req,res)=>{const {data:orders}=await db.from("orders").select("id").eq("customer_id",req.user.id);const ids=(orders||[]).map(o=>o.id);if(!ids.length)return res.json({count:0});const {count}=await db.from("order_messages").select("*",{count:"exact",head:true}).in("order_id",ids).eq("sender_role","admin").eq("read_by_customer",false);res.json({count:count||0});});

app.post("/api/reviews",requireUser,async(req,res)=>{const {data:o}=await db.from("orders").select("id,status").eq("id",req.body.orderId).eq("customer_id",req.user.id).maybeSingle();if(!o||o.status!=="Completed")return res.status(400).json({error:"Only completed orders can be reviewed."});const comment=String(req.body.comment||"").trim();if(comment.length<3)return res.status(400).json({error:"Write a short review."});const {error}=await db.from("reviews").insert({order_id:o.id,customer_id:req.user.id,rating:Number(req.body.rating),comment});if(error)return res.status(400).json({error:error.message});res.json({ok:true});});
app.get("/api/reviews/public",async(req,res)=>{const {data}=await db.from("reviews").select("rating,comment,created_at,customer_id").eq("approved",true).order("created_at",{ascending:false}).limit(9);const ids=[...new Set((data||[]).map(r=>r.customer_id))];let profiles=[];if(ids.length)({data:profiles}=await db.from("profiles").select("id,full_name").in("id",ids));const names=Object.fromEntries((profiles||[]).map(p=>[p.id,p.full_name]));const reviews=(data||[]).map(r=>({...r,customer_name:(names[r.customer_id]||"Customer").split(" ")[0]}));const average=reviews.length?reviews.reduce((s,r)=>s+r.rating,0)/reviews.length:0;res.json({reviews,average,count:reviews.length});});

app.get("/api/admin/orders",admin,async(req,res)=>{await releaseExpired();const [{data:orders},{data:settings},{count}]=await Promise.all([db.from("orders").select("*").order("created_at",{ascending:false}),db.from("store_settings").select("*").eq("id",1).single(),db.from("order_messages").select("*",{count:"exact",head:true}).eq("sender_role","customer").eq("read_by_admin",false)]);const {data:presence}=await db.from("admin_presence").select("*").eq("id",1).single();res.json({orders:orders||[],settings,presence,unreadMessages:count||0});});
app.get("/api/admin/orders/:number",admin,async(req,res)=>{const {data:o}=await db.from("orders").select("*").eq("order_number",req.params.number).maybeSingle();if(!o)return res.status(404).json({error:"Order not found."});await db.from("order_messages").update({read_by_admin:true}).eq("order_id",o.id).eq("sender_role","customer");const [{data:messages},{data:history}]=await Promise.all([db.from("order_messages").select("*").eq("order_id",o.id).order("created_at"),db.from("order_status_history").select("*").eq("order_id",o.id).order("created_at")]);res.json({...o,messages:messages||[],history:history||[],receiptUrl:await signedReceipt(o.receipt_path)});});
app.post("/api/admin/orders/:number/messages",admin,async(req,res)=>{const {data:o}=await db.from("orders").select("id,customer_id").eq("order_number",req.params.number).maybeSingle();if(!o)return res.status(404).json({error:"Order not found."});const text=String(req.body.text||"").trim().slice(0,1500);if(!text)return res.status(400).json({error:"Message is empty."});await db.from("order_messages").insert({order_id:o.id,sender_role:"admin",message:text,read_by_admin:true,read_by_customer:false});await db.from("notifications").insert({customer_id:o.customer_id,order_id:o.id,type:"message",title:"New admin reply",body:text.slice(0,180)});res.json({ok:true});});
app.patch("/api/admin/orders/:number/status",admin,async(req,res)=>{const allowed=["Pending Payment Review","Payment Verified","Approved","Processing","Ready for Delivery","Completed","Declined","Refund Required"],status=String(req.body.status||"");if(!allowed.includes(status))return res.status(400).json({error:"Invalid status."});const {data:o}=await db.from("orders").select("*").eq("order_number",req.params.number).maybeSingle();if(!o)return res.status(404).json({error:"Order not found."});if(o.method==="Robux Instant"){if(["Payment Verified","Approved","Processing","Ready for Delivery","Completed"].includes(status)&&o.reservation_status==="reserved")await db.rpc("finalize_instant_stock",{p_order_id:o.id});if(["Declined","Refund Required"].includes(status)&&["reserved","finalized"].includes(o.reservation_status))await db.rpc("release_instant_stock",{p_order_id:o.id});}
  await db.from("orders").update({status,updated_at:new Date().toISOString()}).eq("id",o.id);await db.from("order_status_history").insert({order_id:o.id,status,changed_by:"admin"});await db.from("order_messages").insert({order_id:o.id,sender_role:"system",message:`Order status changed to ${status}.`,read_by_admin:true,read_by_customer:false});await db.from("notifications").insert({customer_id:o.customer_id,order_id:o.id,type:"status",title:`Order ${status}`,body:`${o.order_number} is now ${status}.`});res.json({ok:true});});
app.patch("/api/admin/settings",admin,async(req,res)=>{const stock=Math.floor(Number(req.body.instantStock));if(!Number.isFinite(stock)||stock<0)return res.status(400).json({error:"Invalid stock."});const {data,error}=await db.from("store_settings").update({instant_stock:stock,updated_at:new Date().toISOString()}).eq("id",1).select().single();if(error)return res.status(400).json({error:error.message});res.json(data);});


app.patch("/api/admin/support-status",admin,async(req,res)=>{
  const row={is_online:!!req.body.isOnline,status_text:String(req.body.statusText||"").slice(0,120),updated_at:new Date().toISOString()};
  const {data,error}=await db.from("admin_presence").update(row).eq("id",1).select().single();if(error)return res.status(400).json({error:error.message});res.json(data);
});
app.post("/api/admin/promos",admin,async(req,res)=>{
  const code=String(req.body.code||"").trim().toUpperCase(),discount=Number(req.body.discountPercent),limit=req.body.usageLimit===null?null:Number(req.body.usageLimit);
  if(!/^[A-Z0-9_-]{3,24}$/.test(code))return res.status(400).json({error:"Promo code must be 3-24 letters or numbers."});
  if(!Number.isFinite(discount)||discount<=0||discount>100)return res.status(400).json({error:"Invalid discount."});
  const {data,error}=await db.from("promo_codes").insert({code,discount_percent:discount,usage_limit:Number.isFinite(limit)?limit:null}).select().single();if(error)return res.status(400).json({error:error.message});res.json(data);
});
app.get("/api/admin/analytics",admin,async(req,res)=>{const {data,error}=await db.from("sales_analytics").select("*").single();if(error)return res.status(400).json({error:error.message});res.json(data);});

app.get("/",async(req,res)=>{const a=await getAuth(req,res);if(!a)return res.redirect("/auth.html");res.sendFile(path.join(PUBLIC,"index.html"));});
app.get("*",(req,res)=>res.sendFile(path.join(PUBLIC,"index.html")));
app.listen(PORT,()=>console.log(`RSR Shop V6 running on port ${PORT}`));
