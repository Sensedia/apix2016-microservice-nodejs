#!/bin/env node
var request = require('request'),
    express = require('express'),
    Sequelize = require('sequelize');

var SensediaCoinsAPI = function () {

    var self = this;

    self.setupVariables = function () {
        self.ipaddress = process.env.OPENSHIFT_NODEJS_IP;
        self.port = process.env.OPENSHIFT_NODEJS_PORT || 8081;

        self.constants = {
            CLIENT_ID: 'dc2f4b97-2005-3eeb-aff8-e3d832033ad3',
            MICROSERVICE_CLIENTE_CRIAR: 'http://api.apix.com.br/soap/v1/clientes/salvarcliente',
            MICROSERVICE_CLIENTE_CONSULTAR: 'http://api.apix.com.br/soap/v1/clientes/consultarclienteporcpf'
        };

        if (typeof self.ipaddress === "undefined") {
            console.warn('No OPENSHIFT_NODEJS_IP var, using 127.0.0.1');
            self.ipaddress = "127.0.0.1";
        }
    };

    self.setupDatabase = function () {
        self.userDB = process.env.OPENSHIFT_MYSQL_DB_USERNAME;
        self.senhaDB = process.env.OPENSHIFT_MYSQL_DB_PASSWORD;
        self.hostDB = process.env.OPENSHIFT_MYSQL_DB_HOST;
        self.portDB = process.env.OPENSHIFT_MYSQL_DB_PORT;
        self.database = process.env.OPENSHIFT_APP_NAME;

        self.sequelize = new Sequelize(self.database, self.userDB, self.senhaDB, {
            host: self.hostDB,
            port: self.portDB
        });

        self.Conta = self.sequelize.define('Conta', {
            numero: {
                type: Sequelize.BIGINT,
                primaryKey: true,
                unique: true
            },
            pessoa_id: Sequelize.BIGINT,
            saldo: Sequelize.DECIMAL,
            data_criacao: {
                type: Sequelize.DATE,
                defaultValue: Sequelize.NOW
            },
            data_fechamento: Sequelize.DATE
        }, {
            freezeTableName: true,
            timestamps: false,
            tableName: 'T_CONTA'
        });

        self.Movimentacao = self.sequelize.define('Movimentacao', {
            id: {
                type: Sequelize.BIGINT,
                primaryKey: true,
                unique: true
            },
            tipo: Sequelize.STRING,
            data: {
                type: Sequelize.DATE,
                defaultValue: Sequelize.NOW
            },
            conta_origem: {
                type: Sequelize.BIGINT,
                references: {
                    model: self.Conta,
                    key: 'numero'
                }
            },
            conta_destino: {
                type: Sequelize.BIGINT,
                references: {
                    model: self.Conta,
                    key: 'numero'
                }
            },
            valor: Sequelize.DECIMAL
        }, {
            freezeTableName: true,
            timestamps: false,
            tableName: 'T_MOVIMENTACAO'
        });

    };

    self.terminator = function (sig) {
        if (typeof sig === "string") {
            console.log('%s: Received %s - terminating sample app ...', Date(Date.now()), sig);
            process.exit(1);
        }
        console.log('%s: Node server stopped.', Date(Date.now()));
    };

    self.setupTerminationHandlers = function () {
        process.on('exit', function () {
            self.terminator();
        });

        ['SIGHUP', 'SIGINT', 'SIGQUIT', 'SIGILL', 'SIGTRAP', 'SIGABRT',
            'SIGBUS', 'SIGFPE', 'SIGUSR1', 'SIGSEGV', 'SIGUSR2', 'SIGTERM'
        ].map(function (element) {
            process.on(element, function () {
                self.terminator(element);
            });
        });
    };

    self.initializeServer = function () {
        self.app = express();
        self.app.use(express.bodyParser());

        function Link(rel, href) {
            this.rel = rel;
            this.href = href;
        }

        function criarConta(pessoa_id, res) {
            var novaConta = {
                numero: parseInt(Math.random() * 100000),
                pessoa_id: pessoa_id,
                saldo: 10
            };

            self.Conta.findOne({where: {pessoa_id: novaConta.pessoa_id}})
                .then(function (conta) {
                    if (conta) {
                        res.status(422).send({mensagem: 'Usuário com conta já cadastrada (nº ' + conta.numero + ')!'});
                    } else {
                        self.Conta.create(novaConta)
                            .then(function (conta) {
                                res.status(201).send(conta);
                            })
                            .catch(function (erro) {
                                res.status(500).send({mensagem: 'Ocorreu um erro inesperado ao salvar nova conta. Trace: ' + erro});
                            });
                    }
                })
                .catch(function (erro) {
                    res.status(500).send({mensagem: 'Ocorreu um erro inesperado ao criar conta. Trace: ' + erro});
                });
        }

        /* consultar contas */
        self.app.get("/contas", function (req, res) {
            res.setHeader('Content-Type', 'json');

            self.Conta.findAll()
                .then(function (resConta) {
                    var contas = [],
                        conta = null;

                    for (var item in resConta) {
                        conta = resConta[item].dataValues;
                        conta.links = [];
                        conta.links.push(new Link("self", req.originalUrl + "/" + conta.numero));
                        conta.links.push(new Link("movimentacoes", req.originalUrl + "/" + conta.numero + "/movimentacoes"));
                        contas.push(conta);
                    }

                    res.json(contas);
                })
                .catch(function (erro) {
                    res.status(500).send({mensagem: 'Ocorreu um erro inesperado ao consultar contas. Trace: ' + erro});
                });
        });

        /* criar conta */
        self.app.post("/contas", function (req, res) {
            res.setHeader('Content-Type', 'json');

            var novaConta = {
                nome: req.body.nome,
                cpf: req.body.cpf,
                senha: req.body.senha
            };

            if (novaConta.cpf && novaConta.cpf.length !== 11) {
                res.status(422).send({mensagem: 'CPF inválido!'});
                res.end();
            }

            request({method: "POST", url: self.constants.MICROSERVICE_CLIENTE_CONSULTAR, headers: {client_id: self.constants.CLIENT_ID}, body: JSON.stringify({cpf: novaConta.cpf})}
            , function (consError, consResponse, consBody) {

                if (consError) {
                    res.status(500).send({mensagem: 'Ocorreu um erro inesperado ao consultar cpf ' + novaConta.cpf + '. Trace: ' + consError});
                }

                var resConta = JSON.parse(consBody);

                if (!resConta.id) {

                    request({method: "POST", url: self.constants.MICROSERVICE_CLIENTE_CRIAR, headers: {client_id: self.constants.CLIENT_ID}, body: JSON.stringify(novaConta)}
                    , function (crError, crResponse, crBody) {

                        if (crError) {
                            res.status(500).send({mensagem: 'Ocorreu um erro inesperado ao criar cliente ' + novaConta.cpf + '. Trace: ' + consError});
                        }

                        var contaCriada = JSON.parse(crBody);
                        criarConta(contaCriada.id.content, res);
                    });

                } else {

                    criarConta(resConta.id.content, res);

                }

            });
        });

        /* consultar contar */
        self.app.get("/contas/:numero(\\d+)", function (req, res) {
            res.setHeader('Content-Type', 'json');

            var numero = req.params.numero;
            self.Conta.findOne({where: {numero: numero}})
                .then(function (conta) {
                    if (!conta) {
                        res.status(404).send({mensagem: 'Conta não localizada!'});
                    } else {
                        var resConta = conta.dataValues;
                        resConta.links = [];
                        resConta.links.push(new Link("self", req.originalUrl));
                        resConta.links.push(new Link("movimentacoes", req.originalUrl + "/movimentacoes"));
                        res.json(resConta);
                    }
                })
                .catch(function (erro) {
                    res.status(500).send({mensagem: 'Ocorreu um erro inesperado ao consultar conta ' + numero + '. Trace: ' + erro});
                });
        });
        
        /* consultar conta por id da pessoa */ 
        self.app.get("/clientes/:pessoa_id(\\d+)/contas", function (req, res) {
            res.setHeader('Content-Type', 'json');

            var pessoa_id = req.params.pessoa_id;
            self.Conta.findOne({where: {pessoa_id: pessoa_id}})
                .then(function (conta) {
                    if (!conta) {
                        res.status(404).send({mensagem: 'Pessoa não localizada!'});
                    } else {
                        var resConta = conta.dataValues;
                        resConta.links = [];
                        resConta.links.push(new Link("self", req.originalUrl));
                        resConta.links.push(new Link("movimentacoes", req.originalUrl + "/movimentacoes"));
                        res.json(resConta);
                    }
                })
                .catch(function (erro) {
                    res.status(500).send({mensagem: 'Ocorreu um erro inesperado ao consultar conta. Trace: ' + erro});
        });
        });

        /* consultar movimentacoes da conta  */
        self.app.get("/contas/:numero(\\d+)/movimentacoes", function (req, res) {
            res.setHeader('Content-Type', 'json');

            var numero = req.params.numero;
            self.Conta.findOne({where: {numero: numero}})
                .then(function (conta) {
                    if (!conta) {
                        res.status(404).send({mensagem: 'Conta não localizada!'});
                    } else {
                        self.Movimentacao.findAll({where: {conta_origem: conta.numero}})
                            .then(function (movimentacoes) {
                                res.json(movimentacoes);
                                res.end();
                            })
                            .catch(function (erro) {
                                res.status(500).send({mensagem: 'Ocorreu um erro inesperado ao consultar movimentacoes da conta ' + numero + '. Trace: ' + erro});
                            });
                    }
                })
                .catch(function (erro) {
                    res.status(500).send({mensagem: 'Ocorreu um erro inesperado ao consultar conta ' + numero + '. Trace: ' + erro});
                });
        });

        /* efetuar transferencia */
        self.app.post("/contas/:numero(\\d+)/movimentacoes", function (req, res) {
            res.setHeader('Content-Type', 'json');

            var numero = req.params.numero,
                movimentacao = {
                    conta_origem: numero,
                    conta_destino: req.body.conta_destino,
                    tipo: 'SAQUE',
                    valor: parseFloat(req.body.valor)
                };

            if (numero === movimentacao.conta_destino) {
                res.status(422).send({mensagem: 'A conta de origem e destino são iguais!'});
                res.end();
            }

            if (movimentacao.valor <= 0) {
                res.status(422).send({mensagem: 'O valor deve ser positivo!'});
                res.end();
            }

            self.Conta.findOne({where: {numero: numero}})
                .then(function (resContaOrigem) {
                    if (!resContaOrigem) {
                        res.status(404).send({mensagem: 'Conta ' + numero + ' não localizada!'});
                    } else if (movimentacao.valor > resContaOrigem.saldo) {
                        res.status(422).send({mensagem: 'A conta origem não possui saldo suficiente (S$ ' + resContaOrigem.saldo + ')!'});
                    } else {

                        self.Conta.findOne({where: {numero: movimentacao.conta_destino}})
                            .then(function (resContaDestino) {

                                resContaOrigem.saldo -= movimentacao.valor;
                                self.Conta.update({saldo: resContaOrigem.saldo}, {where: {numero: resContaOrigem.numero}})
                                    .then(function (resSaldoContaOrigem) {

                                        self.Movimentacao.create(movimentacao)
                                            .then(function (resMovContaOrigem) {

                                                resContaDestino.saldo += movimentacao.valor;
                                                self.Conta.update({saldo: resContaDestino.saldo}, {where: {numero: resContaDestino.numero}})
                                                    .then(function () {

                                                        var movimentacaoDeposito = {
                                                            conta_origem: resContaDestino.numero,
                                                            conta_destino: resContaOrigem.numero,
                                                            tipo: 'DEPOSITO',
                                                            valor: movimentacao.valor
                                                        };

                                                        self.Movimentacao.create(movimentacaoDeposito)
                                                            .then(function (resMovContaDestino) {
                                                                res.status(201).json({mensagem: 'Movimentacao realizada com sucesso!'});
                                                            })
                                                            .catch(function (erro) {
                                                                res.status(500).send({mensagem: 'Ocorreu um erro inesperado ao gerar movimentacao conta destino nº ' + movimentacao.conta_destino + '. Trace: ' + erro});
                                                            });

                                                    })
                                                    .catch(function (erro) {
                                                        res.status(500).send({mensagem: 'Ocorreu um erro inesperado ao salvar saldo conta destino nº ' + movimentacao.conta_destino + '. Trace: ' + erro});
                                                    });

                                            })
                                            .catch(function (erro) {
                                                res.status(500).send({mensagem: 'Ocorreu um erro inesperado ao gerar movimentacao conta origem nº ' + numero + '. Trace: ' + erro});
                                            });

                                    })
                                    .catch(function (erro) {
                                        res.status(500).send({mensagem: 'Ocorreu um erro inesperado ao salvar saldo conta origem nº ' + numero + '. Trace: ' + erro});
                                    });

                            })
                            .catch(function (erro) {
                                res.status(500).send({mensagem: 'Ocorreu um erro inesperado ao consultar conta destino nº ' + movimentacao.conta_destino + '. Trace: ' + erro});
                            });
                    }
                })
                .catch(function (erro) {
                    res.status(500).send({mensagem: 'Ocorreu um erro inesperado ao consultar conta origem nº' + numero + '. Trace: ' + erro});
                });
        });

    };

    self.initialize = function () {
        self.setupVariables();
        self.setupDatabase();
        self.setupTerminationHandlers();

        self.initializeServer();
    };

    self.start = function () {
        self.app.listen(self.port, self.ipaddress, function () {
            console.log('%s: Node server started on %s:%d ...', Date(Date.now()), self.ipaddress, self.port);
        });
    };

};

var zapp = new SensediaCoinsAPI();
zapp.initialize();
zapp.start();
