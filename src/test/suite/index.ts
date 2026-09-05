import * as fs from 'fs';
import * as path from 'path';
import Mocha from 'mocha';

export function run(testsRoot: string): Promise<void> {
  const mocha = new Mocha({ ui: 'tdd', color: true, timeout: 120_000 });

  return new Promise((resolve, reject) => {
    fs.readdir(testsRoot, (err, files) => {
      if (err) {
        reject(err);
        return;
      }
      for (const file of files) {
        if (file.endsWith('.test.js')) {
          mocha.addFile(path.resolve(testsRoot, file));
        }
      }
      try {
        mocha.run((failures: number) => {
          if (failures > 0) {
            reject(new Error(`${failures} test(s) failed`));
          } else {
            resolve();
          }
        });
      } catch (runErr) {
        reject(runErr);
      }
    });
  });
}
