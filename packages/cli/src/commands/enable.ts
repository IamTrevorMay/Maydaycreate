import { Command } from 'commander';

export const enableCommand = new Command('enable')
  .description('Enable a plugin')
  .argument('<id>', 'Plugin ID')
  .action(async (id: string) => {
    try {
      const res = await fetch(`http://localhost:9876/api/plugins/${id}/enable`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        console.log(`Plugin "${id}" enabled`);
      } else {
        console.error(`Failed: ${data.error}`);
      }
    } catch {
      console.error('Server not running. Start with: mayday dev');
    }
  });
