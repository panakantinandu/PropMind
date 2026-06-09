require('dotenv').config();

const ai =
require('./ai.service');

(async () => {

    const result =
    await ai.analyzeTenantRisk({

        tenantName: 'John',

        monthlyIncome: 7000,

        rent: 1500,

        employment: 'Software Engineer',

        creditScore: 720,

        previousLatePayments: 0,

        leaseDuration: 12

    });

    console.log(result);

})();
