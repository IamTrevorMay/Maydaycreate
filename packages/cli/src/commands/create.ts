import { Command } from 'commander';
import fs from 'fs';
import path from 'path';
import Handlebars from 'handlebars';

const PLUGIN_TEMPLATE_INDEX = `import { definePlugin } from '@mayday/sdk';

export default definePlugin({
  async activate(ctx) {
    ctx.log.info('{{name}} activated');
  },

  commands: {
    info: async (ctx) => {
      const seq = await ctx.services.timeline.getActiveSequence();
      const name = seq ? seq.name : 'No active sequence';
      ctx.ui.showToast(name);
      return name;
    },
  },
});
`;

const MANIFEST_TEMPLATE = `{
  "id": "{{id}}",
  "name": "{{name}}",
  "version": "0.1.0",
  "description": "{{description}}",
  "main": "src/index.ts",
  "commands": [
    {
      "id": "info",
      "name": "Info",
      "description": "Show plugin info"
    }
  ],
  "permissions": ["timeline"]
}
`;

const TSCONFIG_TEMPLATE = `{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
`;

const PACKAGE_JSON_TEMPLATE = `{
  "name": "{{id}}",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "src/index.ts",
  "dependencies": {
    "@mayday/sdk": "*"
  },
  "devDependencies": {
    "typescript": "^5.4.0"
  }
}
`;

export const createCommand = new Command('create')
  .description('Scaffold a new Mayday plugin')
  .argument('<name>', 'Plugin name (kebab-case)')
  .option('-d, --description <desc>', 'Plugin description', 'A Mayday Create plugin')
  .action(async (name: string, opts: { description: string }) => {
    const id = name.toLowerCase().replace(/[^a-z0-9-]/g, '-');
    const displayName = name
      .split('-')
      .map(w => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');

    const pluginDir = path.resolve('plugins', id);

    if (fs.existsSync(pluginDir)) {
      console.error(`Plugin directory already exists: ${pluginDir}`);
      process.exit(1);
    }

    fs.mkdirSync(path.join(pluginDir, 'src'), { recursive: true });

    const context = { id, name: displayName, description: opts.description };

    fs.writeFileSync(
      path.join(pluginDir, 'src', 'index.ts'),
      Handlebars.compile(PLUGIN_TEMPLATE_INDEX)(context)
    );

    fs.writeFileSync(
      path.join(pluginDir, 'mayday.json'),
      Handlebars.compile(MANIFEST_TEMPLATE)(context)
    );

    fs.writeFileSync(path.join(pluginDir, 'tsconfig.json'), TSCONFIG_TEMPLATE);
    fs.writeFileSync(path.join(pluginDir, 'package.json'), Handlebars.compile(PACKAGE_JSON_TEMPLATE)(context));

    console.log(`Plugin created: ${pluginDir}`);
    console.log(`  Edit: plugins/${id}/src/index.ts`);
    console.log(`  Run:  mayday dev`);
  });
