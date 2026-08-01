"use strict";
const $=id=>document.getElementById(id);
let key="",orders=[],currentOrder=null;

function esc(value){
  return String(value??"").replace(/[&<>"']/g,c=>({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[c]));
}

function showAdminMessage(text,type=""){
  $("adminMessage").className=`message ${type}`;
  $("adminMessage").textContent=text;
}

async function adminFetch(url,options={}){
  key=$("adminKey").value.trim();
  if(!key)throw new Error("Enter your admin private key.");
  const headers={...(options.headers||{}),"x-admin-key":key};
  const response=await fetch(url,{...options,headers});
  const data=await response.json();
  if(!response.ok)throw new Error(data.error||"Admin request failed.");
  return data;
}

async function openAdminOrder(){
  const order=$("adminOrderNumber").value.trim();
  if(!order)return showAdminMessage("Enter an order number.","error");
  try{
    showAdminMessage("Opening order…");
    currentOrder=await adminFetch(`/api/admin/orders/${encodeURIComponent(order)}`);
    renderCurrentOrder();
    $("adminOrderArea").classList.remove("hidden");
    showAdminMessage("");
  }catch(error){
    $("adminOrderArea").classList.add("hidden");
    showAdminMessage(error.message,"error");
  }
}

function renderCurrentOrder(){
  const o=currentOrder;
  $("adminAvatar").src=o.roblox_avatar_url||"";
  $("adminDisplayName").textContent=o.roblox_display_name||o.roblox_username;
  $("adminUsername").textContent=`@${o.roblox_username}`;
  $("adminCustomerAccount").textContent=o.customer_email?`${o.customer_name||"Customer"} • ${o.customer_email}`:"";
  $("adminStatusBadge").textContent=o.status;
  $("viewReceipt").href=o.receiptUrl||"#";

  $("adminOrderSummary").innerHTML=`
    <div><span>Order Number</span><strong>${esc(o.order_number)}</strong></div>
    <div><span>Method</span><strong>${esc(o.method)} ${o.tax_option!=="N/A"?"— "+esc(o.tax_option):""}</strong></div>
    <div><span>Robux / Item Price</span><strong>${Number(o.amount||0).toLocaleString()} Robux</strong></div>
    <div><span>Customer Receives</span><strong>${Number(o.receive_amount||0).toLocaleString()} Robux</strong></div>
    <div><span>Required Pass Price</span><strong>${Number(o.required_pass_price||0).toLocaleString()} Robux</strong></div>
    <div><span>Payment</span><strong>₱${Number(o.payment||0).toFixed(2)} via ${esc(o.payment_method)}</strong></div>
    <div><span>Sender / Reference</span><strong>${esc(o.sender_name)} • ${esc(o.reference_number)}</strong></div>
    <div><span>Gifting Details</span><strong>${esc([o.game_name,o.item_name,o.gift_details].filter(Boolean).join(" • ")||"N/A")}</strong></div>
  `;

  $("adminChatMessages").innerHTML=(o.messages||[]).map(message=>`
    <div class="chat-message ${message.sender_role==="admin"?"admin-message":"customer-message"}">
      <div>
        <strong>${message.sender_role==="admin"?"RSR Admin":"Customer"}</strong>
        <small>${new Date(message.created_at).toLocaleString()}</small>
      </div>
      <p>${esc(message.message)}</p>
    </div>
  `).join("")||'<p class="hint">No messages yet.</p>';

  $("adminChatMessages").scrollTop=$("adminChatMessages").scrollHeight;
}

async function changeStatus(status){
  if(!currentOrder)return;
  try{
    await adminFetch(`/api/admin/orders/${encodeURIComponent(currentOrder.orderNumber)}/status`,{
      method:"PATCH",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({status})
    });
    await openAdminOrder();
    await loadAllOrders();
  }catch(error){
    showAdminMessage(error.message,"error");
  }
}

async function sendAdminReply(){
  if(!currentOrder)return;
  const text=$("adminChatText").value.trim();
  if(!text)return;
  try{
    await adminFetch(`/api/admin/orders/${encodeURIComponent(currentOrder.orderNumber)}/messages`,{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({text})
    });
    $("adminChatText").value="";
    await openAdminOrder();
  }catch(error){
    showAdminMessage(error.message,"error");
  }
}

async function loadAllOrders(){
  try{
    const data=await adminFetch("/api/admin/orders");
    orders=data.orders||data;$("adminUnreadBadge").textContent=data.unreadMessages||0;$("adminUnreadBadge").classList.toggle("hidden",!(data.unreadMessages||0));
    $("adminControls").classList.remove("hidden");
    if(data.settings)$("instantStockInput").value=data.settings.instant_stock??data.settings.instantStock;if(data.presence){$("supportOnlineInput").checked=!!data.presence.is_online;$("supportStatusText").value=data.presence.status_text||"";}
    updateStats();
    renderOrderList();
  }catch(error){
    showAdminMessage(error.message,"error");
  }
}

function updateStats(){
  $("statOrders").textContent=orders.length;
  $("statPending").textContent=orders.filter(o=>o.status==="Pending").length;
  $("statApproved").textContent=orders.filter(o=>["Approved","Processing","Completed"].includes(o.status)).length;
  const sales=orders
    .filter(o=>["Approved","Processing","Completed"].includes(o.status))
    .reduce((sum,o)=>sum+Number(o.payment||0),0);
  $("statSales").textContent=new Intl.NumberFormat("en-PH",{style:"currency",currency:"PHP"}).format(sales);
}

function renderOrderList(){
  $("orders").innerHTML=orders.map(o=>`
    <article class="admin-order compact-admin-order">
      <div class="admin-order-head">
        <div class="order-profile">
          <img src="${esc(o.roblox_avatar_url)}" alt="">
          <div>
            <h3>${esc(o.roblox_display_name||o.roblox_username)}</h3>
            <p>@${esc(o.roblox_username)} • ${esc(o.order_number)}</p>
          </div>
        </div>
        <span class="selected-badge">${esc(o.status)}</span>
      </div>
      <div class="compact-order-meta">
        <span>${esc(o.method)}${o.tax_option!=="N/A"?" — "+esc(o.tax_option):""}</span>
        <strong>₱${Number(o.payment||0).toFixed(2)}</strong>
      </div>
      <button class="secondary-button open-list-order" data-order="${esc(o.order_number)}">Open Order & Chat</button>
    </article>
  `).join("")||'<p class="hint">No orders yet.</p>';

  document.querySelectorAll(".open-list-order").forEach(button=>{
    button.onclick=()=>{
      $("adminOrderNumber").value=button.dataset.order;
      openAdminOrder();
      window.scrollTo({top:0,behavior:"smooth"});
    };
  });
}

$("openAdminOrder").onclick=openAdminOrder;
$("loadOrders").onclick=loadAllOrders;
$("approveOrder").onclick=()=>changeStatus("Approved");
$("processingOrder").onclick=()=>changeStatus("Processing");
$("completeOrder").onclick=()=>changeStatus("Completed");
$("declineOrder").onclick=()=>changeStatus("Declined");
$("sendAdminChat").onclick=sendAdminReply;

$("saveStock").onclick=async()=>{
  const instantStock=Number($("instantStockInput").value);
  if(!Number.isFinite(instantStock)||instantStock<0)return alert("Enter a valid stock amount.");
  try{
    const data=await adminFetch("/api/admin/settings",{
      method:"PATCH",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({instantStock:Math.floor(instantStock)})
    });
    alert(`Instant stock updated to ${Number(data.instantStock).toLocaleString()} Robux.`);
  }catch(error){
    alert(error.message);
  }
};

$("adminOrderNumber").addEventListener("keydown",event=>{
  if(event.key==="Enter")openAdminOrder();
});

$("saveSupportStatus").onclick=async()=>{
  try{
    await adminFetch("/api/admin/support-status",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({isOnline:$("supportOnlineInput").checked,statusText:$("supportStatusText").value.trim()})});
    alert("Support status updated.");
  }catch(e){alert(e.message);}
};
$("createPromo").onclick=async()=>{
  try{
    const code=$("promoAdminCode").value.trim().toUpperCase(),discountPercent=Number($("promoAdminDiscount").value),usageLimit=$("promoAdminLimit").value?Number($("promoAdminLimit").value):null;
    const d=await adminFetch("/api/admin/promos",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({code,discountPercent,usageLimit})});
    alert(`Promo ${d.code} created.`);
  }catch(e){alert(e.message);}
};
