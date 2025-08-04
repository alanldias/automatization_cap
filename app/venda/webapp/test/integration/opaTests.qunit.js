sap.ui.require(
    [
        'sap/fe/test/JourneyRunner',
        'venda/test/integration/FirstJourney',
		'venda/test/integration/pages/ClientesList',
		'venda/test/integration/pages/ClientesObjectPage',
		'venda/test/integration/pages/EnderecosObjectPage'
    ],
    function(JourneyRunner, opaJourney, ClientesList, ClientesObjectPage, EnderecosObjectPage) {
        'use strict';
        var JourneyRunner = new JourneyRunner({
            // start index.html in web folder
            launchUrl: sap.ui.require.toUrl('venda') + '/index.html'
        });

       
        JourneyRunner.run(
            {
                pages: { 
					onTheClientesList: ClientesList,
					onTheClientesObjectPage: ClientesObjectPage,
					onTheEnderecosObjectPage: EnderecosObjectPage
                }
            },
            opaJourney.run
        );
    }
);