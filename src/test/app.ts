import * as Router from 'koa-router';
import {App} from '../index';
import * as request from 'request-promise';
import {expect} from 'chai';
import * as jsonWebToken from 'jsonwebtoken';
import * as Koa from 'koa';
import Context = Koa.Context;
import {ValidationError} from "../lib/error/validation";
import {AuthError} from "../lib/error/auth";
import {IValidator} from "../lib/validation/interfaces";
import {Controller} from "../lib/koa/controller";
import {InnoError} from "../lib/error/inno";

const router = new Router();

const host = 'http://localhost';

const jwtPort = 9890;
const jwtSecret = 'test-secret';
const jwtPublicPath = '^\/public';

const commonPort = 9891;

const publicResource = '/public/test';
const publicResourceWithError = '/public/errors/common';
const publicResourceWithValidation = '/public/errors/validation';
const protectedResource = '/test';

const validationErrorPrefix = new ValidationError().errorPrefix;
const authErrorPrefix = new AuthError().errorPrefix;
const innoErrorPrefix = new InnoError().errorPrefix;

function makeRequestAddress(port: number, resource: string): string {
    return `${host}:${port}${resource}`;
}

const jwtConfigMock = {
    get: (key: string) => {
        switch (key) {
            case 'port':
                return jwtPort;
            case 'jwt.secret':
                return jwtSecret;
            case 'jwt.publicPath':
                return jwtPublicPath;
            default:
                return '';
        }
    },
    has: (key: string) => {
        switch (key) {
            case 'jwt.secret':
                return true;
            default:
                return '';
        }
    }
};

const commonConfigMock = {
    get: (key: string) => {
        switch (key) {
            case 'port':
                return commonPort;
            default:
                return '';
        }
    },
    has: (key: string) => {
        switch (key) {
            case 'jwt.secret':
                return false;
            default:
                return '';
        }
    }
};

class TestController extends Controller {
    publicResource = async (ctx: Context, next: Function): Promise<void> => {
        ctx.body = 1;
        await next();
    };

    protectedResource = async (ctx: Context, next: Function): Promise<void> => {
        ctx.body = 2;
        await next();
    };

    publicResourceWithError = async (ctx: Context, next: Function): Promise<void> => {
        throw new Error('Test error');
    };

    publicResourceWithValidation = async (ctx: Context, next: Function): Promise<void> => {
        const data = this.validate(ctx, (validator: IValidator) => {
            return {
                testField: validator.isEmail('testField'),
                testQueryField: validator.isInt('testQueryField')
            };
        });

        ctx.body = {
            testField: data.testField,
            testQueryField: data.testQueryField
        };
        await next();
    }
}

const testController = new TestController();

router
    .post(publicResource, testController.publicResource)
    .post(protectedResource, testController.protectedResource)
    .get(publicResourceWithError, testController.publicResourceWithError)
    .post(publicResourceWithValidation, testController.publicResourceWithValidation);

/* tslint:disable:typedef */
describe('app', async function(): Promise<void> {
    before(function(done: Function) {
        // TODO !!!!!! DANGER ZONE - refactor me
        const jwtApp = new App(jwtConfigMock, router);
        const app = new App(commonConfigMock, router);
        setTimeout(done, 1000);
    });

    describe('router', async function() {
        it('serves requests', async function() {
            const response = await request.post(makeRequestAddress(jwtPort, publicResource), {
                form: {},
                json: true
            });
            expect(response.result).to.eq(1);
        });

        it('validates requests', async function() {
            const response = await request.post(makeRequestAddress(jwtPort, publicResourceWithValidation), {
                qs: {
                    testQueryField: ' 1111 '
                },
                form: {
                    testField: '   test@test.ru '
                },
                json: true
            });
            expect(response.result).to.eql({
                testField: 'test@test.ru',
                testQueryField: 1111
            });
        });

        it('returns error when accessing protected resource with no key', async function() {
            const response = await request.post(makeRequestAddress(jwtPort, protectedResource), {
                form: {},
                json: true,
                simple: false
            });
            expect(response.error).to.eq(authErrorPrefix + AuthError.TOKEN_IS_INVALID);
        });

        it('serves protected request with passed key', async function() {
            const token = jsonWebToken.sign({foo: 1}, jwtSecret);
            const response = await request.post(makeRequestAddress(jwtPort, protectedResource), {
                form: {},
                json: true,
                auth: {
                    bearer: token
                }
            });
            expect(response.result).to.eq(2);
        });

        it('makes all routes unprotected w/o jwt config', async function() {
            const response = await request.post(makeRequestAddress(commonPort, protectedResource), {
                form: {},
                json: true
            });
            expect(response.result).to.eq(2);
        });
    });

    describe('errors', async function() {
        it('should catch error and return its code', async function() {
            const response = await request.get(makeRequestAddress(commonPort, publicResourceWithError), {
                json: true,
                simple: false
            });
            expect(response.error).to.eq(innoErrorPrefix + InnoError.INTERNAL);
        });

        it('should return validation error', async function() {
            let response = await request.post(makeRequestAddress(commonPort, publicResourceWithValidation), {
                form: {
                    testField: 'testValue'
                },
                json: true,
                simple: false
            });
            expect(response.error).to.eq(validationErrorPrefix + ValidationError.NO_EMAIL);
            expect(response.details).to.eql({
                invalidField: 'testField',
                invalidValue: 'testValue'
            });

            response = await request.post(makeRequestAddress(commonPort, publicResourceWithValidation), {
                qs: {
                    testQueryField: 'testQueryValue'
                },
                form: {
                    testField: 'test@test.ru'
                },
                json: true,
                simple: false
            });
            expect(response.error).to.eq(validationErrorPrefix + ValidationError.NO_INT);
            expect(response.details).to.eql({
                invalidField: 'testQueryField',
                invalidValue: 'testQueryValue'
            });
        });
    });
});