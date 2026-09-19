import java.io.File;
import java.security.KeyStore;

/**
 * Answers one question: does this password actually unlock this signing key?
 *
 * Gradle only finds out during PackageAndroidArtifact, which is the very last
 * thing a release build does — so a wrong password costs a full build before it
 * is reported, and reports it as `BadPaddingException`, which does not name the
 * secret at fault. This makes the same call the Android Gradle plugin makes
 * (KeystoreHelper -> KeyStore.getKey) so the release workflow can ask the
 * question in a second, before it compiles anything.
 *
 * Passwords arrive by environment rather than as arguments, which would be
 * visible to any other process on the machine through the process table.
 *
 * Exits 0 when the key opens, non-zero otherwise. Run it with Java's
 * single-file source launcher; it needs no build step:
 *
 *   java apps/android/tools/ProbeSigningKey.java
 */
public final class ProbeSigningKey {
  public static void main(String[] args) throws Exception {
    KeyStore keystore = KeyStore.getInstance(
        new File(env("KEYSTORE_PATH")),
        env("STORE_PASSWORD").toCharArray());

    if (keystore.getKey(env("KEY_ALIAS"), env("KEY_PASSWORD").toCharArray()) == null) {
      throw new IllegalStateException("No key named '" + env("KEY_ALIAS") + "' in the keystore.");
    }
  }

  private static String env(String name) {
    String value = System.getenv(name);
    if (value == null) throw new IllegalStateException(name + " is not set.");
    return value;
  }
}
