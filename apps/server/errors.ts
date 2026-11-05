export function fail(message:string,statusCode=400):never {throw Object.assign(new Error(message),{statusCode});}
