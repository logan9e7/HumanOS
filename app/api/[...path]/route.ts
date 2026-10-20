import {env} from 'cloudflare:workers';
import {handleApi,type Environment} from '../../../server/api';
export const dynamic='force-dynamic';
export const GET=(request:Request)=>handleApi(request,env as unknown as Environment);
export const POST=GET;
export const DELETE=GET;
