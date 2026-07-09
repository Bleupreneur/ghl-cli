/** `ghl docs <domain> [command]` — print the API reference for a domain or a single operation. */
import { Command } from 'commander';
import { OPERATIONS } from '../generated/operations';
import { describeOperation } from '../params';
import { UsageError } from '../types';

export function docsCommand(): Command {
  return new Command('docs')
    .description(
      'Show the API reference for a domain (lists its commands) or a specific operation (full detail)',
    )
    .argument('<domain>', 'domain name — run `ghl --help` for the list')
    .argument('[command]', 'command within the domain — omit to list all commands in the domain')
    .showHelpAfterError()
    .action((domain: string, command?: string) => {
      const inDomain = OPERATIONS.filter((o) => o.domain === domain);
      if (inDomain.length === 0) {
        throw new UsageError(
          `Unknown domain '${domain}'. Run \`ghl --help\` to list domains, or \`ghl search ${domain}\`.`,
        );
      }
      if (!command) {
        console.log(`${domain} — ${inDomain.length} operation(s):\n`);
        for (const o of inDomain)
          console.log(`  ghl ${domain} ${o.command}  —  ${o.summary || o.id}`);
        console.log(
          `\nRun \`ghl docs ${domain} <command>\` or \`ghl ${domain} <command> --help\` for full detail.`,
        );
        return;
      }
      const op = inDomain.find((o) => o.command === command);
      if (!op) {
        throw new UsageError(
          `Unknown command 'ghl ${domain} ${command}'. Run \`ghl ${domain} --help\` or \`ghl docs ${domain}\`.`,
        );
      }
      console.log(describeOperation(op));
    });
}
