# Bouquet

Bouquet is a userscript for [NationStates](https://www.nationstates.net) that makes it easier to manage puppets: it keeps a roster of your nations and their logins, and runs a fully customizable pipeline of actions across them.

## Quick Start

1. Install a userscript manager. Any of these work:
   - [ScriptCat](https://scriptcat.org/) (recommended)
   - [Violentmonkey](https://violentmonkey.github.io/)
   - [Tampermonkey](https://www.tampermonkey.net/)

   On Chromium-based browsers you may have to turn on **Allow User Scripts** (or Developer mode) for the extension before it will run scripts.

2. [Click here to install Bouquet.](https://github.com/audreyreal/bouquet/releases/latest/download/Bouquet.user.js) Your userscript manager will ask you to confirm. Updates come from the same link.
3. Open any NationStates page and click the **BOUQUET** button in the top bar, or visit https://www.nationstates.net/page=blank?bouquet=settings&template-overall=none .
4. Enter your main nation when asked. A short tour then walks you through the Manage page.

## Disclaimer

While extensive work has gone into attempting to ensure this tool is legal, it is the player's responsibility to ensure any tool they use is legal. You are responsible for making sure every tool you use follows the [Script Rules](https://forum.nationstates.net/viewtopic.php?p=16394966#p16394966).

## Contributing

To set up a development environment:

1. Clone the repository.
2. Install [Bun](https://bun.sh/).
3. Run `bun install` in the project directory.
4. Run `bun run build` to bundle the script to `dist/Bouquet.user.js`, and `bun run typecheck` to type-check it.

## License

Bouquet is free and open source software licensed under the [GNU General Public License v3.0](LICENSE.md).
