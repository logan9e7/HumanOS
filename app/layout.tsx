import type {Metadata} from 'next';
import './globals.css';
export const metadata:Metadata={title:'HumanOS — Understand, evolve, adapt',description:'A conversation-led model of your changing patterns. Inspect evidence, challenge hypotheses, and see what changed.',icons:{icon:'/favicon.svg'}};
export default function Layout({children}:Readonly<{children:React.ReactNode}>){return <html lang="en"><body>{children}</body></html>;}
