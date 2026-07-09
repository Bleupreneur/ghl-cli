/** `ghl search <keyword…>` — find operations without loading every domain's --help. */
import { Command } from 'commander';
import { OPERATIONS } from '../generated/operations';
import type { Operation } from '../types';

export function searchCommand(): Command {
  return new Command('search')
    .description(
      'Find operations by keyword (matches command path, summary, operationId, API path, tags)',
    )
    .argument('<keyword...>', 'one or more keywords — all must match')
    .option('--domain <domain>', 'restrict to a single domain')
    .option('--json', 'output JSON')
    .showHelpAfterError()
    .action((keywords: string[], opts: { domain?: string; json?: boolean }) => {
      const kws = keywords.map((k) => k.toLowerCase());
      const hits = OPERATIONS.filter((o) => {
        if (opts.domain && o.domain !== opts.domain) return false;
        const hay =
          `${o.domain} ${o.command} ${o.id} ${o.summary} ${o.path} ${o.tags.join(' ')}`.toLowerCase();
        return kws.every((k) => hay.includes(k));
      });

      if (opts.json) {
        console.log(
          JSON.stringify(
            hits.map((h) => ({
              command: `ghl ${h.domain} ${h.command}`,
              method: h.method.toUpperCase(),
              path: h.path,
              summary: h.summary,
              operationId: h.id,
            })),
            null,
            2,
          ),
        );
        return;
      }

      if (hits.length === 0) {
        console.log(`No operations match: ${keywords.join(' ')}`);
        console.log(
          'Tip: try a single broad keyword (e.g. `ghl search appointment`), or `ghl --help` for the domain list.',
        );
        return;
      }

      const byDomain = new Map<string, Operation[]>();
      for (const h of hits) {
        const list = byDomain.get(h.domain);
        if (list) list.push(h);
        else byDomain.set(h.domain, [h]);
      }
      for (const domain of [...byDomain.keys()].sort()) {
        console.log(`\n${domain}`);
        for (const h of byDomain.get(domain)!) {
          console.log(
            `  ghl ${domain} ${h.command}  —  ${h.summary || h.id}  (${h.method.toUpperCase()} ${h.path})`,
          );
        }
      }
      console.log(
        `\n${hits.length} operation(s). Run \`ghl <domain> <command> --help\` for flags, or \`ghl docs <domain> <command>\`.`,
      );
    });
}
