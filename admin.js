<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Account | RSR</title><link rel="stylesheet" href="style.css"></head>
<body class="auth-body"><main class="auth-shell">
<section class="auth-brand-panel"><div class="brand large-brand"><span class="brand-logo">R</span><span><strong>RECK SHOP</strong><small>RSR V6</small></span></div>
<h1>Your orders, messages, and receipts—stored permanently.</h1><p>Use one verified account to buy, track orders, chat with support, and review completed purchases.</p>
<div class="auth-features"><span>✓ Email verification</span><span>✓ Password reset</span><span>✓ Permanent order history</span><span>✓ Unread chat alerts</span></div></section>
<section class="auth-card">
<div class="auth-tabs"><button id="loginTab" class="active">Login</button><button id="registerTab">Register</button></div>
<form id="loginForm"><h2>Welcome back</h2><p class="hint">Login to your RSR account.</p>
<div class="form-group"><label>Email</label><input id="loginEmail" type="email" required autocomplete="email"></div>
<div class="form-group"><label>Password</label><div class="password-row"><input id="loginPassword" type="password" required minlength="8"><button type="button" data-toggle="loginPassword">Show</button></div></div>
<button class="primary-button" type="submit">Login</button><button id="forgotButton" class="link-button" type="button">Forgot password?</button></form>
<form id="registerForm" class="hidden"><h2>Create account</h2><p class="hint">A verification email will be sent.</p>
<div class="form-group"><label>Full Name</label><input id="registerName" required minlength="2" maxlength="60"></div>
<div class="form-group"><label>Email</label><input id="registerEmail" type="email" required></div>
<div class="form-group"><label>Password</label><div class="password-row"><input id="registerPassword" type="password" required minlength="8"><button type="button" data-toggle="registerPassword">Show</button></div></div>
<div class="form-group"><label>Confirm Password</label><input id="registerConfirm" type="password" required minlength="8"></div>
<button class="primary-button" type="submit">Register</button></form>
<form id="forgotForm" class="hidden"><h2>Reset password</h2><p class="hint">We will email you a secure reset link.</p>
<div class="form-group"><label>Email</label><input id="forgotEmail" type="email" required></div>
<button class="primary-button" type="submit">Send Reset Email</button><button id="backLogin" class="link-button" type="button">Back to login</button></form>
<p id="authMessage" class="message"></p></section></main><script src="auth.js"></script></body></html>