import { Command } from 'commander';

export const disableCommand = new Command('disable')
  .description('Disable a plugin')
  .argument('<id>', 'Plugin ID')
  .option('-p, --port <port>', 'Server port', '9876')
  .action(async (id: string, opts: { port: string }) => {
    const port = opts.port;
    try {
      const res = await fetch(`http://localhost:${port}/api/plugins/${id}/disable`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        console.log(`Plugin "${id}" disabled`);
      } else {
        console.error(`Failed: ${data.error}`);
      }
    } catch {
      console.error('Server not running. Start with: mayday dev');
    }
  });
