<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Order Status & Chat | RSR</title><link rel="stylesheet" href="style.css"></head><body>
<header class="navbar"><a class="brand" href="/"><span class="brand-logo">R</span><span><strong>RECK SHOP</strong><small>RSR</small></span></a><nav><a href="/">Shop</a></nav></header>
<main class="status-main"><section class="panel"><span class="small-label">PRIVATE ORDER SUPPORT</span><h1>Order Status & Chat</h1>
<div class="status-search"><input id="orderInput" placeholder="Order number"><input id="tokenInput" type="password" placeholder="Customer private access token"><button id="loadOrder">Open Order & Chat</button></div><p class="token-help">The private token is included in the link shown after the customer submits the order. Never share it publicly.</p><p id="statusMessage" class="message"></p>
<div id="orderArea" class="hidden">
<div class="order-profile"><img id="statusAvatar"><div><h2 id="statusDisplayName"></h2><p id="statusUsername"></p><span id="statusBadge" class="selected-badge"></span></div></div>
<div id="orderSummary" class="order-summary"></div><div id="orderTimeline" class="order-timeline"></div><div id="reservationNotice" class="reservation-notice hidden"></div>
<h2 class="chat-heading">Chat with RSR Support</h2><div id="chatMessages" class="chat-messages"></div>
<div class="chat-compose"><textarea id="chatText" rows="3" placeholder="Type your message…"></textarea><button id="sendChat" class="primary-button">Send Message</button></div>
</div></section></main><script src="status.js"></script></body></html>