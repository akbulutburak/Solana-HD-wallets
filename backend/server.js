const express = require('express');
const cors = require('cors');
const bip39 = require('bip39');
const { Keypair } = require('@solana/web3.js');
const { derivePath } = require('ed25519-hd-key');

const app = express();
const port = 3001;

app.use(cors()); 
app.use(express.json());

// Yardımcı Fonksiyon: Tekrar eden cüzdan türetme mantığını bir araya toplayalım
const deriveWallets = async (mnemonic, count) => {
    const seed = await bip39.mnemonicToSeed(mnemonic);
    const seedHex = seed.toString('hex');
    
    const wallets = [];
    const loopCount = parseInt(count) || 10; // Gelen sayı geçerli değilse varsayılan 10

    for (let i = 0; i < loopCount; i++) {
        const path = `m/44'/501'/${i}'/0'`;
        const derivedSeed = derivePath(path, seedHex).key;
        const keypair = Keypair.fromSeed(derivedSeed);
        
        wallets.push({
            index: i + 1,
            publicKey: keypair.publicKey.toBase58(),
            secretKey: Buffer.from(keypair.secretKey).toString('hex') 
        });
    }
    return { seedHex, wallets };
};

// Mevcut Endpoint'leri `count` parametresini alacak şekilde güncelle
app.get('/api/generate-wallets', async (req, res) => {
    try {
        const { count = 10 } = req.query; // URL'den ?count=X şeklinde alınır
        const mnemonic = bip39.generateMnemonic();
        const { seedHex, wallets } = await deriveWallets(mnemonic, count);

        res.json({
            mnemonic: mnemonic,
            masterSeed: seedHex,
            wallets: wallets
        });

    } catch (error) {
        console.error("Hata:", error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/wallets-from-mnemonic', async (req, res) => {
    try {
        const { mnemonic, count = 10 } = req.body;

        if (!mnemonic || !bip39.validateMnemonic(mnemonic)) {
            return res.status(400).json({ error: "Geçersiz anımsatıcı." });
        }

        const { seedHex, wallets } = await deriveWallets(mnemonic, count);

        res.json({
            mnemonic: mnemonic,
            masterSeed: seedHex,
            wallets: wallets
        });

    } catch (error) {
        console.error("Hata:", error);
        res.status(500).json({ error: error.message });
    }
});

// YENİ ENDPOINT: Belirli bir indeksteki tek bir cüzdanı getir
app.post('/api/wallet-by-index', async (req, res) => {
    try {
        const { mnemonic, index } = req.body;
        const walletIndex = parseInt(index);

        if (!mnemonic || !bip39.validateMnemonic(mnemonic)) {
            return res.status(400).json({ error: "Geçersiz anımsatıcı." });
        }
        if (isNaN(walletIndex) || walletIndex < 1) {
            return res.status(400).json({ error: "Geçersiz indeks numarası." });
        }

        const seed = await bip39.mnemonicToSeed(mnemonic);
        const seedHex = seed.toString('hex');
        
        // İstenen indeksteki cüzdanı türet (index-1 çünkü 0-bazlı)
        const path = `m/44'/501'/${walletIndex - 1}'/0'`;
        const derivedSeed = derivePath(path, seedHex).key;
        const keypair = Keypair.fromSeed(derivedSeed);
        
        const walletData = {
            index: walletIndex,
            publicKey: keypair.publicKey.toBase58(),
            secretKey: Buffer.from(keypair.secretKey).toString('hex') 
        };

        res.json(walletData);

    } catch (error) {
        console.error("Hata:", error);
        res.status(500).json({ error: error.message });
    }
});

app.listen(port, () => {
    console.log(`Backend sunucusu http://localhost:${port} adresinde çalışıyor.`);
});
