import { createContext } from 'react';

/** The signed-in shopper ({ email, cards }) or null; provided by the app shell. */
export const AccountContext = createContext(null);
