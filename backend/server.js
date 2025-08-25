const express = require('express');
const cors = require('cors');
const bip39 = require('bip39');
const { 
    Keypair, 
    Connection, 
    PublicKey, 
    LAMPORTS_PER_SOL, 
    clusterApiUrl,
    Transaction,
    SystemProgram 
} = require('@solana/web3.js');
const { derivePath } = require('ed25519-hd-key');

const app = express();
const port = 3001;

// Solana Devnet'e bağlanalım
const connection = new Connection(clusterApiUrl('testnet'), 'confirmed');

app.use(cors()); 
app.use(express.json());

// RPC oran sınırlarına takılmamak için toplu bakiye sorgulama fonksiyonu
const getBalancesInBatches = async (pubkeys, batchSize = 20) => {
    const balances = new Map();
    for (let i = 0; i < pubkeys.length; i += batchSize) {
        const batch = pubkeys.slice(i, i + batchSize);
        const batchPublicKeys = batch.map(p => new PublicKey(p));
        
        try {
            const balanceInfos = await connection.getMultipleAccountsInfo(batchPublicKeys);
            balanceInfos.forEach((info, index) => {
                const publicKey = batch[index];
                const balance = info ? info.lamports / LAMPORTS_PER_SOL : 0;
                balances.set(publicKey, balance);
            });
        } catch (error) {
            console.error(`Bakiye sorgulama hatası (batch ${i / batchSize}):`, error);
            // Hata durumunda bu gruptaki cüzdanların bakiyesini 0 olarak ayarlayalım
            batch.forEach(publicKey => balances.set(publicKey, 0));
        }
    }
    return balances;
};


// Yardımcı Fonksiyon: Cüzdan türetme mantığını bakiye sorgulama ile genişletelim
const deriveWallets = async (mnemonic, count, withBalance = false) => {
    const seed = await bip39.mnemonicToSeed(mnemonic);
    const seedHex = seed.toString('hex');
    
    let wallets = [];
    const loopCount = parseInt(count) || 10;

    for (let i = 0; i < loopCount; i++) {
        const path = `m/44'/501'/${i}'/0'`;
        const derivedSeed = derivePath(path, seedHex).key;
        const keypair = Keypair.fromSeed(derivedSeed);
        
        wallets.push({
            index: i + 1,
            publicKey: keypair.publicKey.toBase58(),
            secretKey: Buffer.from(keypair.secretKey).toString('hex'),
            balanceSOL: 0 // Başlangıç değeri
        });
    }

    if (withBalance) {
        const publicKeys = wallets.map(w => w.publicKey);
        const balances = await getBalancesInBatches(publicKeys);
        wallets = wallets.map(wallet => ({
            ...wallet,
            balanceSOL: balances.get(wallet.publicKey) || 0
        }));
    }

    return { seedHex, wallets };
};

// Mevcut Endpoint'leri `withBalance` parametresini alacak şekilde güncelle
app.get('/api/generate-wallets', async (req, res) => {
    try {
        const { count = 10, withBalance = 'false' } = req.query; 
        const shouldFetchBalance = withBalance === 'true';
        const mnemonic = bip39.generateMnemonic();
        const { seedHex, wallets } = await deriveWallets(mnemonic, count, shouldFetchBalance);

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
        const { mnemonic, count = 10, withBalance = false } = req.body;
        const shouldFetchBalance = withBalance === true;

        if (!mnemonic || !bip39.validateMnemonic(mnemonic)) {
            return res.status(400).json({ error: "Geçersiz anımsatıcı." });
        }

        const { seedHex, wallets } = await deriveWallets(mnemonic, count, shouldFetchBalance);

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

// YENİ ENDPOINT: Belirli bir indeksteki tek bir cüzdanı getir (Bakiye destekli)
app.post('/api/wallet-by-index', async (req, res) => {
    try {
        const { mnemonic, index, withBalance = false } = req.body;
        const walletIndex = parseInt(index);

        if (!mnemonic || !bip39.validateMnemonic(mnemonic)) {
            return res.status(400).json({ error: "Geçersiz anımsatıcı." });
        }
        if (isNaN(walletIndex) || walletIndex < 1) {
            return res.status(400).json({ error: "Geçersiz indeks numarası." });
        }

        const seed = await bip39.mnemonicToSeed(mnemonic);
        const seedHex = seed.toString('hex');
        
        const path = `m/44'/501'/${walletIndex - 1}'/0'`;
        const derivedSeed = derivePath(path, seedHex).key;
        const keypair = Keypair.fromSeed(derivedSeed);
        
        let balanceSOL = 0;
        if (withBalance) {
            try {
                const lamports = await connection.getBalance(keypair.publicKey);
                balanceSOL = lamports / LAMPORTS_PER_SOL;
            } catch (error) {
                console.error(`Tekli bakiye sorgulama hatası:`, error);
                // Hata durumunda bakiye 0 olarak kalır
            }
        }

        const walletData = {
            index: walletIndex,
            publicKey: keypair.publicKey.toBase58(),
            secretKey: Buffer.from(keypair.secretKey).toString('hex'),
            balanceSOL: balanceSOL
        };

        res.json(walletData);

    } catch (error) {
        console.error("Hata:", error);
        res.status(500).json({ error: error.message });
    }
});

// YENİ ENDPOINT: Tüm fonları 1. cüzdana topla (Sweep)
app.post('/api/sweep-funds', async (req, res) => {
    try {
        const { mnemonic, count } = req.body;
        const walletCount = parseInt(count);

        if (!mnemonic || !bip39.validateMnemonic(mnemonic)) {
            return res.status(400).json({ error: "Geçersiz anımsatıcı." });
        }
        if (isNaN(walletCount) || walletCount < 2) {
            return res.status(400).json({ error: "Fonları toplamak için en az 2 cüzdan olmalı." });
        }

        const seed = await bip39.mnemonicToSeed(mnemonic);
        const seedHex = seed.toString('hex');

        // 1. Hedef cüzdanı türet
        const destPath = `m/44'/501'/0'/0'`;
        const destDerivedSeed = derivePath(destPath, seedHex).key;
        const destKeypair = Keypair.fromSeed(destDerivedSeed);
        const destPublicKey = destKeypair.publicKey;

        let totalSweptLamports = 0;
        let successfulTxCount = 0;
        const transactionPromises = [];

        // 2. cüzdandan başlayarak tüm cüzdanları dolaş
        for (let i = 1; i < walletCount; i++) {
            const sourcePath = `m/44'/501'/${i}'/0'`;
            const sourceDerivedSeed = derivePath(sourcePath, seedHex).key;
            const sourceKeypair = Keypair.fromSeed(sourceDerivedSeed);

            const balanceLamports = await connection.getBalance(sourceKeypair.publicKey);
            
            // Sabit bir işlem ücreti varsayalım (genellikle 5000 lamports)
            const feeLamports = 5000; 

            if (balanceLamports > feeLamports) {
                const amountToSend = balanceLamports - feeLamports;
                
                const transaction = new Transaction().add(
                    SystemProgram.transfer({
                        fromPubkey: sourceKeypair.publicKey,
                        toPubkey: destPublicKey,
                        lamports: amountToSend,
                    })
                );
                
                // İşlemi gönder ve onayla
                const promise = connection.sendTransaction(transaction, [sourceKeypair]).then(signature => {
                    return connection.confirmTransaction(signature, 'confirmed').then(() => {
                        totalSweptLamports += amountToSend;
                        successfulTxCount++;
                        console.log(`Cüzdan #${i + 1} -> #${1}: ${amountToSend / LAMPORTS_PER_SOL} SOL aktarıldı. İmza: ${signature}`);
                    });
                }).catch(err => {
                    console.error(`Cüzdan #${i + 1} transfer hatası:`, err.message);
                });

                transactionPromises.push(promise);
            }
        }
        
        // Tüm işlemleri paralel olarak bekle
        await Promise.all(transactionPromises);

        res.json({
            message: "Toplama işlemi tamamlandı.",
            totalSweptSOL: totalSweptLamports / LAMPORTS_PER_SOL,
            successfulTransfers: successfulTxCount,
        });

    } catch (error) {
        console.error("Toplama işlemi sırasında genel hata:", error);
        res.status(500).json({ error: error.message });
    }
});


app.listen(port, () => {
    console.log(`Backend sunucusu http://localhost:${port} adresinde çalışıyor.`);
});
