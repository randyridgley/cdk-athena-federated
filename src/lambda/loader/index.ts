
import { DynamoDBClient, BatchWriteItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall } from '@aws-sdk/util-dynamodb';
import { faker } from '@faker-js/faker';
import { Redis } from 'ioredis';

const redis = new Redis({
  host: process.env.REDIS_HOST,
  port: 6379, // Default Redis port
});

interface Ticker {
  ticker: string,
  id: string,
  value: string,
}

async function handler(event: any) {
  console.log(event)
  const region: string = process.env.AWS_REGION!.toString().trim();
  const ddbClient = new DynamoDBClient({ region: region });
  const dynamoDbTableName = process.env.DYNAMODB_TABLE!;
  const numRecords = 100000;
  const batchSize = 25;
  for (let i = 0; i < numRecords; i += batchSize) {
    const batchRecords: Ticker[] = [];
    // const redisBatch = [];
    for (let j = 0; j < batchSize; j++) {
      const fakeTicker = faker.company.name();
      const randomID = Math.floor(Math.random() * 1000000);
      const fakeValue = parseFloat(faker.finance.amount(10, 1000, 2));

      const tickerRecord: Ticker = {
        id: randomID.toString(),
        ticker: fakeTicker,
        value: fakeValue.toString(),
      }
      // let req = {
      //   PutRequest: {
      //     Item: {
      //       id: { S: randomID.toString() },
      //       ticker: { S: fakeTicker },
      //     },
      //   },
      // }
      batchRecords.push(tickerRecord);
      // await redis.set(randomID.toString(), fakeValue.toString())        
      // redisBatch.push(['SET', fakeTicker, fakeValue.toString()]);
    }
    const params = {
      RequestItems: {
        [dynamoDbTableName]: batchRecords.map(record => {
          return {
            PutRequest: {
              Item: marshall(record),
            },
          }
        }),
      },
    };

    try {
      await ddbClient.send(new BatchWriteItemCommand(params));
      // await redis.pipeline(redisBatch).exec();
      const pipeline = redis.pipeline();
      batchRecords.map(record => {
        pipeline.zadd('companies', 'ticker', record.ticker, 'price', record.value);
      })
      await pipeline.exec()

      console.log('DynamoDB and Redis batches inserted successfully');
    } catch (err) {
      console.error('Error inserting batches:', err);
    }
  }
  redis.disconnect();
  return {
    statusCode: 200,
    body: JSON.stringify('Records loaded successfully'),
  };
};

exports.handler = handler;