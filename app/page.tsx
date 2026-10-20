import HumanOS from './HumanOS';
import {getChatGPTUser} from './chatgpt-auth';
export const dynamic='force-dynamic';
export default async function Page(){const user=await getChatGPTUser();return <HumanOS displayName={user?.fullName||null}/>;}
