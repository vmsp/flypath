/**
 * Outputs a JSON configuration object to be passed to `setup-apple-spm.js`'s
 * `--config-command` option. It's a stand in for `npx react-native config`.
 */

function main(): void {
  const [root, sourceDir, reactNativePath] = process.argv.slice(2);

  process.stdout.write(
    `${JSON.stringify({
      root,
      reactNativePath,
      dependencies: {},
      project: { ios: { sourceDir } },
    })}\n`,
  );
}

main();
