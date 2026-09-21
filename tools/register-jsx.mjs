/** Registers the JSX loader: `node --import ./tools/register-jsx.mjs --test`. */
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

register('./jsx-loader.mjs', pathToFileURL(`${import.meta.dirname}/`));
