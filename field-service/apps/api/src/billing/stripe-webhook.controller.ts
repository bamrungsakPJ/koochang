import { Controller, Headers, HttpCode, Param, Post, Req } from '@nestjs/common';
import { StripeService } from './stripe.service.js';
import { apiError, uuidPattern } from '../shared/api-error.js';
@Controller('billing/stripe/webhook')
export class StripeWebhookController {
 constructor(private readonly stripe:StripeService){}
 @Post(':credentialId') @HttpCode(200)
 receive(@Param('credentialId')id:string,@Headers('stripe-signature')signature:string,@Req()request:{rawBody?:Buffer}){
   if(!uuidPattern.test(id)||!request.rawBody||typeof signature!=='string')throw apiError(400,'VALIDATION_ERROR');
   return this.stripe.webhook(id,request.rawBody,signature);
 }
}
