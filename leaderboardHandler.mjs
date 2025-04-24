import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";

const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({}));

export async function handler(event) {
  const tableName = process.env.DYNAMODB_TABLE;

  console.log("Received event:", JSON.stringify(event, null, 2));

  const method = event.httpMethod || event.requestContext?.http?.method;

  try {
    if (method === 'POST') {
      const data = JSON.parse(event.body);
      const { puzzleDate, userId, finalScore, stagesCompleted, completed, puzzleLetters, longestWord, rarestWord, entries } = data;

      if (!puzzleDate || !userId || !entries || !Array.isArray(entries)) {
        return response(400, { error: 'Missing required fields' });
      }

      const item = {
        PK: `PUZZLE#${puzzleDate}`,
        SK: `USER#${userId}`,
        puzzleDate,
        userId,
        completed,
        finalScore,
        stagesCompleted,
        puzzleLetters,
        longestWord,
        rarestWord,
        entries,
        timestamp: new Date().toISOString()
      };

      await dynamo.send(new PutCommand({ TableName: tableName, Item: item }));
      return response(200, { success: true });
    }

    if (event.httpMethod === 'GET') {
      const puzzleDate = event.queryStringParameters?.puzzleDate;
      if (!puzzleDate) return response(400, { error: 'Missing puzzleDate' });

      const result = await dynamo.send(new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: 'PK = :pk',
        ExpressionAttributeValues: {
          ':pk': `PUZZLE#${puzzleDate}`
        }
      }));

      const entries = result.Items || [];
      return response(200, { entries });
    }

    return response(405, { error: 'Method not allowed' });
  } catch (err) {
    console.error(err);
    return response(500, { error: 'Internal server error' });
  }
}

function response(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    },
    body: JSON.stringify(body)
  };
}