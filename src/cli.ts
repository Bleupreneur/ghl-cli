#!/usr/bin/env node
/**
 * ghl — token-light GoHighLevel CLI.
 *
 * One Bash tool, ~0 idle context cost: discover everything on demand via
 *   ghl --help  →  ghl <domain> --help  →  ghl <domain> <command> --help
 * or jump straight to a command with  ghl search <keyword>.
 *
 * The whole `<domain> <command>` tree is generated from the official GHL OpenAPI specs
 * (see scripts/gen.ts → src/generated/operations.ts). The built-in commands below are
 * hand-written: auth, raw, search, docs.
 */
import { Command } from 'commander';
import { buildDomainCommands, listDomains } from './buildCommands';
import { authCommand } from './commands/auth';
import { docsCommand } from './commands/docs';
import { rawCommand } from './commands/raw';
import { searchCommand } from './commands/search';
import { GENERATED_AT, OPERATIONS } from './generated/operations';
import { printError } from './output';

const program = new Command('ghl');

program
  .description(
    'Token-light GoHighLevel CLI — full v2 API, generated from the official OpenAPI specs.',
  )
  .version(
    `ghl-cli 0.1.0  (${OPERATIONS.length} operations${GENERATED_AT ? `, digest ${GENERATED_AT}` : ''})`,
    '-v, --version',
  )
  // Shared options — also re-declared on every leaf command so they work before *or* after the
  // command path (commander only accepts an option where it's defined; optsWithGlobals() merges).
  .option('--profile <name>', 'credential profile to use (default: the configured default profile)')
  .option('--api-key <key>', 'override API key for this invocation')
  .option('--location <id>', 'override / inject the locationId (sub-account)')
  .option('--json', 'force JSON output (the default when stdout is not a TTY)')
  .option('--pretty', 'pretty-printed JSON output')
  .option('-q, --quiet', 'output only the data payload')
  .showHelpAfterError()
  .allowExcessArguments(false);

// Built-in commands.
program.addCommand(authCommand());
program.addCommand(rawCommand());
program.addCommand(searchCommand());
program.addCommand(docsCommand());

// Generated GHL API domain commands.
for (const cmd of buildDomainCommands()) program.addCommand(cmd);

// Friendly footer on `ghl --help`.
program.addHelpText('after', () => {
  const domains = listDomains();
  return (
    `\nGHL API domains (${domains.length}, ${OPERATIONS.length} operations total):\n` +
    `  ${domains.join('  ')}\n\n` +
    'Examples:\n' +
    '  ghl auth add --name dlf --api-key <PIT> --location <id>   # one-time setup\n' +
    "  ghl contacts --help                                      # list a domain's commands\n" +
    '  ghl contacts get <contactId>                             # run one\n' +
    '  ghl search appointment                                   # find a command by keyword\n' +
    '  ghl raw GET /contacts/search/duplicate --query email=x@y.com   # any endpoint\n'
  );
});

program.parseAsync(process.argv).catch(printError);
