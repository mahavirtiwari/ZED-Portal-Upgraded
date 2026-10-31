package org.qcin.zed.shared

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.io.File
import java.io.FileInputStream
import java.io.IOException
import java.security.KeyStore
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * New in V4 (audit, offline data not encrypted): what the app keeps on the phone is encrypted at rest.
 *
 * One AES-256-GCM key lives in the Android Keystore (alias [ALIAS], not exportable, no user authentication). It
 * encrypts the string values of the app's SharedPreferences (`zedenc1:` + Base64(iv + ciphertext)) and wraps the
 * random per-install SQLCipher key of the databases (preference file [PREFS], key [DATABASE_KEY]).
 */
object SecureStore {
    private const val KEYSTORE = "AndroidKeyStore"
    private const val ALIAS = "zed_local_data"
    private const val TRANSFORMATION = "AES/GCM/NoPadding"
    private const val IV_BYTES = 12
    private const val TAG_BITS = 128
    private const val PREFS = "zed_secure_store"
    private const val DATABASE_KEY = "database_key"
    const val PREFIX = "zedenc1:"

    @Synchronized
    private fun secretKey(): SecretKey {
        val keyStore = KeyStore.getInstance(KEYSTORE).apply { load(null) }
        (keyStore.getKey(ALIAS, null) as? SecretKey)?.let { return it }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE)
        generator.init(
            KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build()
        )
        return generator.generateKey()
    }

    fun isEncrypted(value: String) = value.startsWith(PREFIX)

    fun encrypt(plain: String): String {
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, secretKey())
        val out = cipher.iv + cipher.doFinal(plain.toByteArray(Charsets.UTF_8))
        return PREFIX + Base64.encodeToString(out, Base64.NO_WRAP)
    }

    /** Null when the value cannot be decrypted (not ours, or the Keystore key is gone). */
    fun decrypt(value: String): String? = try {
        val bytes = Base64.decode(value.substring(PREFIX.length), Base64.NO_WRAP)
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.DECRYPT_MODE, secretKey(), GCMParameterSpec(TAG_BITS, bytes, 0, IV_BYTES))
        String(cipher.doFinal(bytes, IV_BYTES, bytes.size - IV_BYTES), Charsets.UTF_8)
    } catch (e: Exception) {
        null
    }

    /** A preference value as the app reads it: decrypted, or a plain legacy value as is. */
    fun reveal(value: String): String? = if (isEncrypted(value)) decrypt(value) else value

    /**
     * The SQLCipher key of this install (64 hex characters), made on first use. If the wrapped key can no longer be
     * unwrapped, it is kept under another name (never removed) and a new key is made; the databases it encrypted are
     * then moved aside by the JavaScript side, not deleted.
     */
    @Synchronized
    fun databaseKey(context: Context): String {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        prefs.getString(DATABASE_KEY, null)?.let { stored ->
            decrypt(stored)?.let { return it }
            prefs.edit().putString(DATABASE_KEY + "_unreadable_" + System.currentTimeMillis(), stored).commit()
        }
        val bytes = ByteArray(32).also { SecureRandom().nextBytes(it) }
        val hex = ZedDeviceModule.bytesToHex(bytes)
        // commit(), not apply(): the key must be on disk before any database is encrypted with it.
        if (!prefs.edit().putString(DATABASE_KEY, encrypt(hex)).commit()) throw IOException("Cannot store the database key")
        return hex
    }
}

/** File operations of the in-place database encryption (src/db/encryptedDatabase.ts). */
object DatabaseFiles {
    const val TEMP_SUFFIX = ".zedenc-tmp"
    private val COMPANIONS = listOf("-wal", "-shm", "-journal")
    private val SQLITE_HEADER = "SQLite format 3\u0000".toByteArray(Charsets.US_ASCII)

    private fun companion(file: File, suffix: String) = File(file.path + suffix)

    fun path(context: Context, name: String): File = context.getDatabasePath(name)

    fun state(context: Context, name: String): String {
        val file = path(context, name)
        if (!file.exists()) return "missing"
        if (file.length() == 0L) {
            // An empty file is a new database, unless a journal still holds its first pages.
            val journal = listOf("-wal", "-journal").any { companion(file, it).let { c -> c.exists() && c.length() > 0 } }
            return if (journal) "plain" else "missing"
        }
        val head = ByteArray(SQLITE_HEADER.size)
        val read = FileInputStream(file).use { it.read(head) }
        // Shorter than a header: let SQLite judge it as a plain file (the migration then fails safely and keeps it).
        if (read < SQLITE_HEADER.size) return "plain"
        return if (head.contentEquals(SQLITE_HEADER)) "plain" else "encrypted"
    }

    fun deleteTemp(context: Context, name: String) {
        require(name.endsWith(TEMP_SUFFIX)) { "Not a temporary database: $name" }
        val file = path(context, name)
        for (s in COMPANIONS) companion(file, s).delete()
        file.delete()
    }

    fun replaceWithEncrypted(context: Context, name: String, tempName: String) {
        require(tempName.endsWith(TEMP_SUFFIX)) { "Not a temporary database: $tempName" }
        val file = path(context, name)
        val temp = path(context, tempName)
        if (!temp.exists() || temp.length() == 0L) throw IOException("The encrypted copy of $name is missing")
        for (s in COMPANIONS) {
            if (companion(temp, s).let { it.exists() && it.length() > 0 }) throw IOException("The encrypted copy of $name is still open")
        }
        // Pages still in the plain file's journal would be lost or, worse, applied to the encrypted file.
        for (s in listOf("-wal", "-journal")) {
            if (companion(file, s).let { it.exists() && it.length() > 0 }) throw IOException("$name still has a journal")
        }
        for (s in COMPANIONS) {
            companion(file, s).delete()
            companion(temp, s).delete()
        }
        // rename(2): the plain file is replaced in one step, so a crash leaves either the plain or the encrypted file.
        if (!temp.renameTo(file)) throw IOException("Cannot replace $name")
    }

    fun moveAside(context: Context, name: String, reason: String): String {
        val file = path(context, name)
        val safe = reason.replace(Regex("[^A-Za-z0-9_-]"), "_")
        val asideName = "$name.$safe-${System.currentTimeMillis()}"
        val aside = path(context, asideName)
        for (s in COMPANIONS) companion(file, s).let { if (it.exists()) it.renameTo(companion(aside, s)) }
        if (file.exists() && !file.renameTo(aside)) throw IOException("Cannot move $name aside")
        return asideName
    }
}
