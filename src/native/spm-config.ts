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
