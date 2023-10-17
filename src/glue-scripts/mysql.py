import sys
import boto3
import hashlib
import string
import random
from awsglue.transforms import *
from awsglue.utils import getResolvedOptions
from pyspark.context import SparkContext
from awsglue.context import GlueContext
from awsglue.job import Job

args = getResolvedOptions(sys.argv, ['JOB_NAME', 'source_connection', 'table_name', 'kinesis_stream'])

sc = SparkContext()
glueContext = GlueContext(sc)
spark = glueContext.spark_session
job = Job(glueContext)
job.init(args["JOB_NAME"], args)

# Script generated for node Relational DB
mysql_dynamic_frame = glueContext.create_dynamic_frame.from_options(
    connection_type="mysql",
    connection_options={
        "useConnectionProperties": "true",
        "dbtable": args['table_name'],
        "connectionName": args['source_connection'],
        # "hashfield" : "id",
        # "hashpartitions": "10",
        # "enablePartitioningForSampleQuery":True, 
        # "sampleQuery": "select * from " + args["table_name"] + " where name = 'Randy'"
    },
    transformation_ctx="read_from_mysql",
)

mysql_dataframe = mysql_dynamic_frame.toDF()

# Creating the SparkSession
# spark = SparkSession.builder.appName("My Demo ETL App").getOrCreate()
# spark.sparkContext.setLogLevel('ERROR')
# Select columns with where clause
# mysql_dataframe = spark.read \
#     .format("jdbc") \
#     .option("driver", "com.mysql.cj.jdbc.Driver") \
#     .option("url", "jdbc:mysql://localhost:3306/emp") \
#     .option("query", "select * from " + args["table_name"] + " where name = 'Randy'") \
#     .option("numPartitions", 5) \
#     .option("user", "root") \
#     .option("password", "root") \
#     .load()

mysql_dataframe.show()

def send_batch_to_kinesis(iterator):
    kinesis_client = boto3.client("kinesis")
    records = []
    for row in iterator:
        # Convert each row to JSON and create Kinesis records
        partitionKey = ''.join(random.choices(string.ascii_letters + string.digits, k=10)) 
        record = {
            "Data": str(row.asDict()),
            "PartitionKey": hashlib.sha256(partitionKey.encode()).hexdigest()
        }
        records.append(record)

    if records:   
        # Send the batch of records to Kinesis using put_records
        kinesis_client.put_records(
            Records=records,
            StreamName=args["kinesis_stream"]
        )

mysql_dataframe.foreachPartition(send_batch_to_kinesis)

job.commit()











