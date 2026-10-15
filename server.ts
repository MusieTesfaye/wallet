// Bun SQLite + WebSocket Streaming Server for SENA Keyless Wallet
import { Database } from "bun:sqlite";

const PORT = 3001;
const DB_PATH = "wallet.db";

// Initialize SQLite Database
const db = new Database(DB_PATH);
db.run("PRAGMA journal_mode = WAL;");

// Create Tables
db.run(`
  CREATE TABLE IF NOT EXISTS accounts (
    address TEXT PRIMARY KEY,
    email TEXT,
    name TEXT,
    picture TEXT,
    sub TEXT,
    aud TEXT,
    ephemeral_public_key TEXT,
    ephemeral_private_key TEXT,
    zk_proof TEXT,
    nonce INTEGER DEFAULT 0,
    usdc_balance INTEGER DEFAULT 0,
    sena_balance INTEGER DEFAULT 0,
    created_at INTEGER
  );
`);

db.run(`
  CREATE TABLE IF NOT EXISTS transactions (
    id TEXT PRIMARY KEY,
    hash TEXT UNIQUE,
    sender TEXT,
    sender_email TEXT,
    recipient TEXT,
    recipient_email TEXT,
    amount_usdc INTEGER,
    fee_usdc INTEGER,
    status TEXT,
    block_height INTEGER,
    epk_signature TEXT,
    timestamp INTEGER
  );
`);

db.run(`
  CREATE TABLE IF NOT EXISTS stream_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_type TEXT,
    payload TEXT,
    timestamp INTEGER
  );
`);

console.log(`[SQLite] Database initialized at ${DB_PATH}`);

// Seed initial accounts (Alice & Bob) if not present
const existingAlice = db.query("SELECT address FROM accounts WHERE email = ?").get("alice@gmail.com");
if (!existingAlice) {
  db.run(`
    INSERT INTO accounts (address, email, name, picture, sub, aud, ephemeral_public_key, zk_proof, nonce, usdc_balance, sena_balance, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    "0x812d45a7d656897c8cf4234586d1234567890abcdef1234567890abcdef581e831b",
    "alice@gmail.com",
    "Alice Walker",
    "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=150&auto=format&fit=crop&q=80",
    "google-oauth2|alice-10928374",
    "sena-mobile-wallet-v1",
    "0x00",
    "0x00",
    0,
    10_000_000, // 10.00 USDC
    50_000_000,
    Date.now() - 1000
  ]);
  console.log("[SQLite] Seeded Account 1: Alice Walker (10.00 USDC)");
}

const existingBob = db.query("SELECT address FROM accounts WHERE email = ?").get("bob@gmail.com");
if (!existingBob) {
  db.run(`
    INSERT INTO accounts (address, email, name, picture, sub, aud, ephemeral_public_key, zk_proof, nonce, usdc_balance, sena_balance, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    "0x629f259b1234567890abcdef1234567890abcdef1234567890abcdef7489e9d4",
    "bob@gmail.com",
    "Bob Martinez",
    "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&auto=format&fit=crop&q=80",
    "google-oauth2|bob-8839210",
    "sena-mobile-wallet-v1",
    "0x00",
    "0x00",
    0,
    5_000_000, // 5.00 USDC
    50_000_000,
    Date.now()
  ]);
  console.log("[SQLite] Seeded Account 2: Bob Martinez (5.00 USDC)");
}

// Global Block Height simulation tracking
let currentBlockHeight = 1;

// Bun HTTP + WebSocket Server
const server = Bun.serve({
  port: PORT,
  fetch(req, server) {
    const url = new URL(req.url);

    // 1. WebSocket Upgrade
    if (url.pathname === "/ws") {
      const upgraded = server.upgrade(req);
      if (upgraded) return undefined;
      return new Response("WebSocket upgrade failed", { status: 400 });
    }

    // CORS Headers
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    if (req.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    // 2. REST Endpoints
    // GET /api/accounts
    if (url.pathname === "/api/accounts" && req.method === "GET") {
      const rows = db.query("SELECT * FROM accounts ORDER BY created_at DESC").all();
      return Response.json(rows, { headers: corsHeaders });
    }

    // POST /api/accounts (Upsert Account)
    if (url.pathname === "/api/accounts" && req.method === "POST") {
      return (async () => {
        try {
          const body: any = await req.json();
          const existing = db.query("SELECT address FROM accounts WHERE address = ?").get(body.address);
          if (existing) {
            db.run(`
              UPDATE accounts SET 
                email = ?, name = ?, picture = ?, ephemeral_public_key = ?, ephemeral_private_key = ?, zk_proof = ?
              WHERE address = ?
            `, [body.email, body.name, body.picture, body.ephemeralPublicKeyHex, body.ephemeralPrivateKeyHex, body.zkProofHex, body.address]);
          } else {
            db.run(`
              INSERT INTO accounts (address, email, name, picture, sub, aud, ephemeral_public_key, ephemeral_private_key, zk_proof, nonce, usdc_balance, sena_balance, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [
              body.address,
              body.email,
              body.name,
              body.picture,
              body.sub,
              body.aud,
              body.ephemeralPublicKeyHex,
              body.ephemeralPrivateKeyHex,
              body.zkProofHex,
              body.nonce || 0,
              body.balances?.usdc || 0,
              body.balances?.sena || 50_000_000,
              Date.now()
            ]);
          }

          // Broadcast account created/updated
          server.publish("wallet-stream", JSON.stringify({
            type: "ACCOUNT_UPSERTED",
            address: body.address,
            email: body.email,
            name: body.name,
            timestamp: Date.now()
          }));

          return Response.json({ success: true, address: body.address }, { headers: corsHeaders });
        } catch (err: any) {
          return Response.json({ error: err.message }, { status: 400, headers: corsHeaders });
        }
      })();
    }

    // POST /api/faucet (Claim +50 USDC)
    if (url.pathname === "/api/faucet" && req.method === "POST") {
      return (async () => {
        try {
          const { address, amount = 50_000_000 } = await req.json();
          db.run("UPDATE accounts SET usdc_balance = usdc_balance + ? WHERE address = ?", [amount, address]);
          const updated: any = db.query("SELECT * FROM accounts WHERE address = ?").get(address);

          const eventPayload = {
            type: "FAUCET_CLAIMED",
            address,
            amountAdded: amount,
            newBalance: updated ? updated.usdc_balance : amount,
            timestamp: Date.now()
          };

          db.run("INSERT INTO stream_events (event_type, payload, timestamp) VALUES (?, ?, ?)", [
            "FAUCET_CLAIMED", JSON.stringify(eventPayload), Date.now()
          ]);

          server.publish("wallet-stream", JSON.stringify(eventPayload));

          return Response.json(eventPayload, { headers: corsHeaders });
        } catch (err: any) {
          return Response.json({ error: err.message }, { status: 400, headers: corsHeaders });
        }
      })();
    }

    // POST /api/transfer (Execute Transfer & Stream over WebSockets)
    if (url.pathname === "/api/transfer" && req.method === "POST") {
      return (async () => {
        try {
          const { sender, recipient, amountUsdc, feeUsdc = 1000, epkSignatureHex, zkProofHex, senderEmail, recipientEmail } = await req.json();

          let senderRow: any = db.query("SELECT * FROM accounts WHERE address = ?").get(sender);
          if (!senderRow) {
            db.run(`
              INSERT INTO accounts (address, email, name, picture, sub, aud, ephemeral_public_key, zk_proof, nonce, usdc_balance, sena_balance, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 10000000, 50000000, ?)
            `, [
              sender,
              senderEmail || "user@sena.network",
              senderEmail ? senderEmail.split("@")[0] : "Keyless User",
              `https://api.dicebear.com/7.x/identicon/svg?seed=${encodeURIComponent(sender)}`,
              "google-oauth2|dynamic",
              "sena-mobile-wallet-v1",
              "0x00",
              "0x00",
              Date.now()
            ]);
            senderRow = db.query("SELECT * FROM accounts WHERE address = ?").get(sender);
          }

          if (senderRow.usdc_balance < (amountUsdc + feeUsdc)) {
            return Response.json({ error: "Insufficient USDC balance" }, { status: 400, headers: corsHeaders });
          }

          const txHash = "0x" + Array.from(crypto.getRandomValues(new Uint8Array(32)))
            .map(b => b.toString(16).padStart(2, "0")).join("");

          // Atomic SQLite Transaction
          db.transaction(() => {
            // Deduct from sender
            db.run("UPDATE accounts SET usdc_balance = usdc_balance - ?, nonce = nonce + 1 WHERE address = ?", [
              amountUsdc + feeUsdc, sender
            ]);

            // Credit recipient if exists, or insert new
            const recipientRow: any = db.query("SELECT * FROM accounts WHERE address = ?").get(recipient);
            if (recipientRow) {
              db.run("UPDATE accounts SET usdc_balance = usdc_balance + ? WHERE address = ?", [amountUsdc, recipient]);
            } else {
              db.run(`
                INSERT INTO accounts (address, email, name, picture, sub, aud, ephemeral_public_key, zk_proof, nonce, usdc_balance, sena_balance, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 50000000, ?)
              `, [
                recipient,
                recipientEmail || "recipient@sena.network",
                recipientEmail ? recipientEmail.split("@")[0] : "Recipient",
                `https://api.dicebear.com/7.x/identicon/svg?seed=${encodeURIComponent(recipient)}`,
                "oidc-recipient",
                "sena-mobile-wallet-v1",
                "0x00",
                "0x00",
                amountUsdc,
                Date.now()
              ]);
            }

            // Record transaction
            db.run(`
              INSERT INTO transactions (id, hash, sender, sender_email, recipient, recipient_email, amount_usdc, fee_usdc, status, block_height, epk_signature, timestamp)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [
              txHash.slice(0, 16),
              txHash,
              sender,
              senderEmail || senderRow.email,
              recipient,
              recipientEmail || "",
              amountUsdc,
              feeUsdc,
              "pending",
              currentBlockHeight,
              epkSignatureHex || "",
              Date.now()
            ]);
          })();

          // Fetch updated balances
          const senderUpdated: any = db.query("SELECT usdc_balance, nonce FROM accounts WHERE address = ?").get(sender);
          const recipientUpdated: any = db.query("SELECT usdc_balance FROM accounts WHERE address = ?").get(recipient);

          // 1. Immediately stream tx pending event over WebSockets
          const streamPacket = {
            type: "TX_STREAM",
            status: "pending",
            hash: txHash,
            sender,
            recipient,
            amountUsdc,
            feeUsdc,
            senderBalance: senderUpdated?.usdc_balance,
            recipientBalance: recipientUpdated?.usdc_balance,
            timestamp: Date.now()
          };

          server.publish("wallet-stream", JSON.stringify(streamPacket));

          // 2. Simulate soft-confirmation within 600ms and stream confirmation
          setTimeout(() => {
            currentBlockHeight += 1;
            db.run("UPDATE transactions SET status = 'soft_confirmed', block_height = ? WHERE hash = ?", [
              currentBlockHeight, txHash
            ]);

            const confirmedPacket = {
              type: "TX_STREAM",
              status: "soft_confirmed",
              hash: txHash,
              blockHeight: currentBlockHeight,
              timestamp: Date.now()
            };
            server.publish("wallet-stream", JSON.stringify(confirmedPacket));
          }, 600);

          return Response.json(streamPacket, { headers: corsHeaders });
        } catch (err: any) {
          return Response.json({ error: err.message }, { status: 500, headers: corsHeaders });
        }
      })();
    }

    // GET /api/transactions
    if (url.pathname === "/api/transactions" && req.method === "GET") {
      const rows = db.query("SELECT * FROM transactions ORDER BY timestamp DESC LIMIT 50").all();
      return Response.json(rows, { headers: corsHeaders });
    }

    return new Response("SENA Bun SQLite & WebSocket API Service", { headers: corsHeaders });
  },

  websocket: {
    open(ws) {
      ws.subscribe("wallet-stream");
      console.log(`[WebSocket] Client connected (Subscribed to wallet-stream)`);
      ws.send(JSON.stringify({
        type: "CONNECTED",
        message: "Connected to SENA SQLite Real-Time WebSocket Stream",
        blockHeight: currentBlockHeight,
        timestamp: Date.now()
      }));
    },
    message(ws, message) {
      // Echo or client ping
      if (message === "ping") {
        ws.send("pong");
      }
    },
    close(ws) {
      console.log(`[WebSocket] Client disconnected`);
    }
  }
});

console.log(`[SENA Server] Running Bun SQLite REST API & WebSocket Stream on http://127.0.0.1:${PORT}`);
console.log(`[SENA Server] WebSocket endpoint: ws://127.0.0.1:${PORT}/ws`);
