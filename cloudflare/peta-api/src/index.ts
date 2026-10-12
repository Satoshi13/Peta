export default {
  async fetch(request: Request): Promise<Response> {
    if (request.method === 'GET' && new URL(request.url).pathname === '/v1/health') return Response.json({ok:true});
    return Response.json({error:'not_found',message:'Unknown endpoint.'},{status:404});
  }
};
