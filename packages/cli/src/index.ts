import { Command } from 'commander';
import { createRequire } from 'module';
import { createCommand } from './commands/create.js';
import { devCommand } from './commands/dev.js';
import { buildCommand } from './commands/build.js';
import { listCommand } from './commands/list.js';
import { enableCommand } from './commands/enable.js';
import { disableCommand } from './commands/disable.js';
import { installCommand } from './commands/install.js';
import { doctorCommand } from './commands/doctor.js';

const require = createRequire(import.meta.url);
const pkg = require('../package.json');

const program = new Command();

program
  .name('mayday')
  .description('Mayday Create — Plugin development platform for Adobe Premiere Pro')
  .version(pkg.version);

program.addCommand(createCommand);
program.addCommand(devCommand);
program.addCommand(buildCommand);
program.addCommand(listCommand);
program.addCommand(enableCommand);
program.addCommand(disableCommand);
program.addCommand(installCommand);
program.addCommand(doctorCommand);

program.parse();
