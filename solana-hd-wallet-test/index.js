const bip39 = require('bip39');
const { Keypair } = require('@solana/web3.js');
const { derivePath } = require('ed25519-hd-key');

// 1. Kütüphanenin kendisi tarafından YENİ ve GEÇERLİ bir anımsatıcı oluşturuluyor.
const mnemonic = bip39.generateMnemonic();
console.log("Otomatik Oluşturulan Anımsatıcı Kelimeler:", mnemonic);

// 2. Oluşturulan bu kelimelerin standartlara uygun ve geçerli olup olmadığı KONTROL EDİLİYOR.
const isMnemonicValid = bip39.validateMnemonic(mnemonic);
console.log(`Bu kelimeler geçerli mi? (Is Mnemonic Valid?): ${isMnemonicValid}`);

// Eğer kelimeler geçersizse, program hata verip duracak.
if (!isMnemonicValid) {
    console.error("HATA: Geçersiz anımsatıcı kelimeler oluşturuldu. Program durduruluyor.");
    process.exit(1);
}

async function generateWallets() {
    // 3. Anımsatıcı kelimelerden bir "seed" (tohum) oluşturun
    const seed = await bip39.mnemonicToSeed(mnemonic);
    console.log("\nOluşturulan Ana Seed (Hex):", seed.toString('hex'));

    console.log("\n==================================================");
    console.log("Standartlara Uygun Türetilmiş Cüzdanlar");
    console.log("==================================================");
    console.log("NOT: Phantom'a yukarıdaki OTOMATİK OLUŞTURULAN kelimeleri girdiğinizde 'Cüzdan 1' adresini görmelisiniz.");

    // 4. Farklı türetme yolları (derivation paths) kullanarak sıralı cüzdanlar oluşturun
    for (let i = 0; i < 5; i++) {
        const path = `m/44'/501'/${i}'/0'`;
        const derivedSeed = derivePath(path, seed.toString('hex')).key;
        const keypair = Keypair.fromSeed(derivedSeed);

        console.log(`\nCüzdan ${i + 1} (Path: ${path}):`);
        console.log(`  -> Genel Anahtar (Adres): ${keypair.publicKey.toBase58()}`);
        console.log(`  -> Özel Anahtar: ${Buffer.from(keypair.secretKey).toString('hex')}`);
    }
}

generateWallets().catch(err => {
    console.error("Bir hata oluştu:", err);
});
