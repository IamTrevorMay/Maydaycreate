import { Command } from 'commander';
import { createCommand } from './commands/create.js';
import { devCommand } from './commands/dev.js';
import { buildCommand } from './commands/build.js';
import { listCommand } from './commands/list.js';
import { enableCommand } from './commands/enable.js';
import { disableCommand } from './commands/disable.js';
import { installCommand } from './commands/install.js';
import { doctorCommand } from './commands/doctor.js';

const program = new Command();

program
  .name('mayday')
  .description('Mayday Create — Plugin development platform for Adobe Premiere Pro')
  .version('0.1.0');

program.addCommand(createCommand);
program.addCommand(devCommand);
program.addCommand(buildCommand);
program.addCommand(listCommand);
program.addCommand(enableCommand);
program.addCommand(disableCommand);
program.addCommand(installCommand);
program.addCommand(doctorCommand);

program.parse();
