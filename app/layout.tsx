import type {Metadata} from 'next';
import './globals.css';
export const metadata:Metadata={title:'HumanOS — A space to be yourself',description:'A private conversation that remembers context and adapts to you. You control what stays.',icons:{icon:'/favicon.svg'}};
export default function Layout({children}:Readonly<{children:React.ReactNode}>){return <html lang="en"><body>{children}</body></html>;}
