# Quick Admin Setup - Copy & Paste This

## Step 1: Run Migrations

In Render Shell (hostclaw-api), paste this EXACT command:

```bash
node config/migrate.js
```

## Step 2: Create Admin User

In the same Shell, paste this EXACT command (all on one line):

```bash
node -e "const bcrypt=require('bcryptjs'),{query}=require('./config/database'),crypto=require('crypto');bcrypt.hash('admin123',12).then(h=>{const id=crypto.randomUUID();return query('INSERT INTO users(id,email,password,name,plan,credits,has_paid)VALUES($1,$2,$3,$4,$5,$6,1)ON CONFLICT(email)DO UPDATE SET has_paid=1,plan=\$5', [id,'admin@hostclaw.ai',h,'Admin','enterprise',1000])}).then(()=>console.log('✅ Admin created: admin@hostclaw.ai / admin123')).catch(e=>console.error('❌',e.message))"
```

## Step 3: Verify

Check if user was created:

```bash
node -e "const{query}=require('./config/database');query('SELECT email,name,plan,has_paid FROM users').then(r=>console.log(r.rows))"
```

## Step 4: Add API Key

Go to Render Dashboard → hostclaw-api → Environment

Add:
```
OPENAI_API_KEY=sk-your-openai-key-here
```

## Done!

Login at: https://hostclaw-web.onrender.com/admin.html
- Email: admin@hostclaw.ai
- Password: admin123
