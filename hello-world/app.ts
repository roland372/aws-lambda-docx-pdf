import AWS, { S3 } from 'aws-sdk';
import PizZip, { LoadData } from 'pizzip';
import Docxtemplater from 'docxtemplater';
import * as fs from 'fs/promises';
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { canBeConvertedToPDF, convertTo } from '@shelf/aws-lambda-libreoffice';

//? Postman
// {
// 	"name": "Hello",
// 	"token": "World",
// 	"bucketName": "00bucket",
// 	"inputDocxName": "input.docx",
// 	"outputDocxName": "output.docx",
// 	"outputPdfName": "output.pdf"
// }

const S3Client = new S3({
	accessKeyId: 'Q3AM3UQ867SPQQA43P2F',
	secretAccessKey: 'zuf+tfteSlswRu7BJ86wekitnifILbZam1KYY3TG',
	endpoint: 'play.min.io',
	s3ForcePathStyle: true,
	signatureVersion: 'v4',
	correctClockSkew: true,
});

type TInput = {
	name: string;
	token: string;
	bucketName: string;
	inputDocxName: string;
	outputDocxName: string;
	outputPdfName: string;
};

//! sam local start-api
export const lambdaHandler = async (
	event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
	try {
		const {
			name,
			token,
			bucketName,
			inputDocxName,
			outputDocxName,
			outputPdfName,
		}: TInput = JSON.parse(event.body || '{}');

		const lambda = new AWS.Lambda({
			apiVersion: '2015-03-31',
			endpoint: 'http://172.17.0.1:3001',
			sslEnabled: false,
		});

		const dataToSend = {
			args: [
				'--files=1.pdf,2.pdf', `--bucket=${bucketName}`, '--filename=test.pdf',
			],
		};

		const params = {
			FunctionName: 'PdfMergerFunction',
			InvocationType: 'RequestResponse',
			Payload: JSON.stringify(dataToSend),
		};

		if (!inputDocxName || !outputDocxName || !outputPdfName) {
			return {
				statusCode: 400,
				body: JSON.stringify({
					message:
						"Can't convert file to PDF. Missing input or output file names.",
				}),
			};
		}

		const inputConfig = {
			Key: inputDocxName,
			Bucket: bucketName,
		};

		const inputFile = await S3Client.getObject(inputConfig).promise();
		console.log(`<----- File ${inputDocxName} downloaded ----->`);

		const zip = new PizZip(inputFile.Body as LoadData);
		const doc = new Docxtemplater(zip, {
			delimiters: {
				start: '{{',
				end: '}}',
			},
			paragraphLoop: true,
			linebreaks: true,
		});

		doc.render({
			name: name || 'John',
			token: token || 'Great!',
		});

		const buf = doc.getZip().generate({
			type: 'nodebuffer',
			compression: 'DEFLATE',
		});

		await fs.writeFile(`../../tmp/${outputDocxName}`, buf);
		console.log(`<----- File filled and saved as ${outputDocxName} ----->`);

		if (!canBeConvertedToPDF(outputDocxName)) {
			console.log("<----- Can't convert file to PDF ----->");
			return {
				statusCode: 400,
				body: JSON.stringify({
					message: "Can't convert file to PDF",
				}),
			};
		}

		await convertTo(outputDocxName, 'pdf');
		console.log('<----- File converted to PDF ----->');

		const outputPDF = await fs.readFile(`../../tmp/${outputPdfName}`);
		const outputConfig = {
			Key: outputPdfName,
			Bucket: bucketName,
			Body: outputPDF,
		};

		await S3Client.putObject(outputConfig)
			.promise()
			.then(() => {
				console.log('PDF file uploaded successfully.');
			})
			.catch(err => {
				console.log('err: ', err);
				throw err;
			});

		await fs.unlink(`../../tmp/${outputPdfName}`);
		console.log('<----- PDF file deleted from container. ----->');

		S3Client.deleteObject(
			{
				Bucket: bucketName,
				Key: inputDocxName,
			},
			err => {
				if (err) {
					console.error(`<----- Error deleting file: ${inputDocxName} ${err}`);
				} else {
					console.log(
						`<----- ${inputDocxName} file deleted from bucket. ----->`
					);
				}
			}
		);

		await lambda
			.invoke(params, function (err, data) {
				if (err) console.log(err);
				else console.log(`<----- Data sent successfully ${data} ----->`);
			})
			.promise();

		return {
			statusCode: 200,
			body: JSON.stringify({
				message: 'File converted and saved successfully',
			}),
			headers: { 'content-type': 'application/json' },
		};
	} catch (err) {
		console.log('<----- JAKI ERROR? ----->', err);
		return {
			statusCode: 500,
			body: JSON.stringify({
				message: 'Internal Server Error',
			}),
		};
	}
};