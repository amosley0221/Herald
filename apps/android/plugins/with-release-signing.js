const { withAppBuildGradle } = require('expo/config-plugins');

/**
 * Teaches the generated Android project to sign release builds with a real
 * keystore.
 *
 * `expo prebuild` emits a project whose release build type is signed with the
 * debug keystore, which Android will install but which is regenerated on every
 * machine — so the next build would be signed with a different key and refuse
 * to install over the first. That breaks updating, which is the whole point.
 *
 * This injects a `release` signing config fed from Gradle properties:
 *
 *   ./gradlew assembleRelease \
 *     -PHERALD_STORE_FILE=herald.keystore \
 *     -PHERALD_STORE_PASSWORD=... \
 *     -PHERALD_KEY_ALIAS=herald \
 *     -PHERALD_KEY_PASSWORD=...
 *
 * When those properties are absent the build falls back to debug signing, so a
 * local `expo run:android` still works without a keystore.
 */

const SIGNING_CONFIG = `
        release {
            // Populated from -P properties; see plugins/with-release-signing.js.
            if (project.hasProperty('HERALD_STORE_FILE')) {
                storeFile file(project.property('HERALD_STORE_FILE'))
                storePassword project.property('HERALD_STORE_PASSWORD')
                keyAlias project.property('HERALD_KEY_ALIAS')
                keyPassword project.property('HERALD_KEY_PASSWORD')
            }
        }`;

/** Chooses the real keystore when one was supplied, debug otherwise. */
const SIGNING_SELECTOR =
  'signingConfig project.hasProperty(\'HERALD_STORE_FILE\') ? signingConfigs.release : signingConfigs.debug';

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (gradleConfig) => {
    let contents = gradleConfig.modResults.contents;

    if (gradleConfig.modResults.language !== 'groovy') {
      throw new Error(
        'with-release-signing expects a Groovy build.gradle; the Expo template changed.',
      );
    }

    // Idempotent: prebuild may run over an existing android/ directory.
    if (!contents.includes("project.hasProperty('HERALD_STORE_FILE')")) {
      const signingConfigs = /signingConfigs\s*\{/;
      if (!signingConfigs.test(contents)) {
        throw new Error('Could not find a signingConfigs block in build.gradle.');
      }
      contents = contents.replace(signingConfigs, (match) => `${match}${SIGNING_CONFIG}`);

      // The release build type points at debug signing in the stock template.
      const releaseBuildType = /(buildTypes\s*\{[\s\S]*?release\s*\{[\s\S]*?)signingConfig signingConfigs\.debug/;
      if (!releaseBuildType.test(contents)) {
        throw new Error(
          'Could not find the release build type\'s signingConfig in build.gradle.',
        );
      }
      contents = contents.replace(releaseBuildType, `$1${SIGNING_SELECTOR}`);
    }

    gradleConfig.modResults.contents = contents;
    return gradleConfig;
  });
};
