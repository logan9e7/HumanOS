export function secureResponse(response:Response){
 const result=new Response(response.body,response);
 result.headers.set('x-content-type-options','nosniff');
 result.headers.set('referrer-policy','strict-origin-when-cross-origin');
 result.headers.set('permissions-policy','camera=(), microphone=(), geolocation=()');
 result.headers.set('content-security-policy',"base-uri 'self'; object-src 'none'; form-action 'self'");
 if(result.headers.get('content-type')?.includes('text/html'))result.headers.set('cache-control','private, no-store');
 return result;
}
