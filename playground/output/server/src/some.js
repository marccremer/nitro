import { app } from '@azure/functions';

app.http('helloWorld1231', {
    methods: ['POST', 'GET'],
    handler: async (request, context) => {
        context.log('Http function was triggered.');
        return { body: 'Hello, world!' };
    }
});
