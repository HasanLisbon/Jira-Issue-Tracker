import properties from './main/resources/src.properties?raw';

export const messages: Record<string, string> = Object.fromEntries(
  properties.split('\n').filter((line) => line.includes('=')).map((line) => {
    const separator = line.indexOf('=');
    return [line.slice(0, separator), line.slice(separator + 1).trim()];
  }),
);
